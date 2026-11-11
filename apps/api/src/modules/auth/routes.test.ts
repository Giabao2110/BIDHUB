import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { expectError, startTestApi } from '../../../test/http.js';
import { verifyPassword } from './password.js';

test('HTTP auth uses protected cookies, rotates sessions, verifies CSRF, and revokes or expires access', async t => {
  const origin = 'https://bidhub.test.invalid';
  const { client, db } = await startTestApi(t, origin);
  const alice = client();
  const bob = client();
  const input = { email: ' Alice@Test.Invalid ', displayName: ' Alice ', password: 'local fixture password' };
  const registration = { method: 'POST', body: JSON.stringify(input) };
  const sessionCookie = '__Host-bidhub_session';

  await expectError(await alice.send('/auth/me'), 401, 'UNAUTHENTICATED');
  await expectError(await alice.send('/auth/register', registration), 403, 'INVALID_CSRF');
  await expectError(await alice.send('/auth/csrf', { headers: { Origin: 'https://other.invalid' } }), 403, 'INVALID_CSRF');

  const boot = await alice.send('/auth/csrf');
  assert.equal(boot.headers.get('access-control-allow-origin'), origin);
  assert.equal(boot.headers.get('access-control-allow-credentials'), 'true');
  const seedHeader = boot.headers.getSetCookie()[0];
  assert.match(seedHeader, /^__Host-bidhub_csrf=/);
  assert.match(seedHeader, /; HttpOnly; Secure; SameSite=Lax/);
  assert.match(seedHeader, /; Path=\//);
  assert.doesNotMatch(seedHeader, /; Domain=/i);
  const { csrfToken: anonymousToken } = await boot.json();
  assert.equal(await alice.csrf(), anonymousToken);
  await bob.csrf();
  await expectError(await bob.send('/auth/register', {
    ...registration, headers: { 'X-CSRF-Token': anonymousToken },
  }), 403, 'INVALID_CSRF');
  await expectError(await alice.send('/auth/register', {
    ...registration, headers: { 'X-CSRF-Token': anonymousToken, Origin: 'https://other.invalid' },
  }), 403, 'INVALID_CSRF');
  await expectError(await alice.write('/auth/register', 'POST', { ...input, password: 'short' }), 422, 'INVALID_INPUT');

  const registered = await alice.write('/auth/register', 'POST', { ...input, role: 'ADMIN' });
  assert.equal(registered.status, 201);
  const registrationCookie = registered.headers.getSetCookie()[0];
  assert.match(registrationCookie, /^__Host-bidhub_session=/);
  assert.match(registrationCookie, /; HttpOnly; Secure; SameSite=Lax/);
  assert.match(registrationCookie, /; Expires=/);
  assert.doesNotMatch(registrationCookie, /; Domain=/i);
  const oldSession = alice.cookies.get(sessionCookie);
  assert.ok(oldSession);
  const { user } = await registered.json();
  assert.deepEqual(user, { id: user.id, email: 'alice@test.invalid', displayName: 'Alice', role: 'MEMBER' });
  assert.deepEqual(await (await alice.send('/auth/me')).json(), { user });
  const stored = (await db.query('SELECT password_hash, token_hash FROM users JOIN sessions ON users.id=sessions.user_id')).rows[0];
  assert.equal(stored.token_hash, createHash('sha256').update(oldSession).digest('hex'));
  assert.match(stored.password_hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(stored.password_hash, input.password), true);

  await expectError(await alice.send('/auth/logout', {
    method: 'POST', headers: { 'X-CSRF-Token': anonymousToken },
  }), 403, 'INVALID_CSRF');
  await expectError(await bob.write('/auth/register', 'POST', input), 409, 'EMAIL_EXISTS');
  const login = { email: input.email, password: input.password };
  const invalid = await expectError(await alice.write('/auth/login', 'POST', {
    ...login, password: 'wrong',
  }), 401, 'INVALID_CREDENTIALS');
  const missing = await expectError(await alice.write('/auth/login', 'POST', {
    ...login, email: 'unknown@test.invalid',
  }), 401, 'INVALID_CREDENTIALS');
  assert.equal(missing, invalid);

  const loggedIn = await alice.write('/auth/login', 'POST', login);
  assert.equal(loggedIn.status, 200);
  assert.deepEqual(await loggedIn.json(), { user });
  const newSession = alice.cookies.get(sessionCookie);
  assert.ok(newSession && newSession !== oldSession);
  const sessionHeader = (token: string) => ({ Cookie: `${sessionCookie}=${token}` });
  await expectError(await alice.send('/auth/me', { headers: sessionHeader(oldSession) }), 401, 'UNAUTHENTICATED');

  const logout = await alice.write('/auth/logout', 'POST');
  assert.equal(logout.status, 204);
  assert.match(logout.headers.getSetCookie()[0], /^__Host-bidhub_session=;/);
  assert.match(logout.headers.getSetCookie()[0], /; Path=\//);
  assert.match(logout.headers.getSetCookie()[0], /; HttpOnly; Secure; SameSite=Lax/);
  assert.equal(await logout.text(), '');
  assert.equal((await alice.write('/auth/logout', 'POST')).status, 204);
  await expectError(await alice.send('/auth/me', { headers: sessionHeader(newSession) }), 401, 'UNAUTHENTICATED');

  assert.equal((await alice.write('/auth/login', 'POST', login)).status, 200);
  await db.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second'");
  await expectError(await alice.send('/auth/me'), 401, 'UNAUTHENTICATED');
  assert.equal((await alice.write('/auth/login', 'POST', login)).status, 200);
  await db.query('UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1', [user.id]);
  await expectError(await alice.send('/auth/me'), 401, 'UNAUTHENTICATED');
  const disabled = await expectError(await alice.write('/auth/login', 'POST', login), 401, 'INVALID_CREDENTIALS');
  assert.equal(disabled, invalid);

  await expectError(await alice.write('/auth/login', 'POST', login), 401, 'INVALID_CREDENTIALS');
  const limited = await alice.write('/auth/login', 'POST', login);
  await expectError(limited, 429, 'RATE_LIMITED');
  assert.match(limited.headers.get('retry-after') ?? '', /^\d+$/);

  await db.query('ALTER TABLE sessions ADD CONSTRAINT reject_new_sessions CHECK (false) NOT VALID');
  await expectError(await bob.write('/auth/register', 'POST', { ...input, email: 'rollback@test.invalid' }), 500, 'INTERNAL_ERROR');
  assert.equal((await db.query("SELECT 1 FROM users WHERE email='rollback@test.invalid'")).rowCount, 0);
});
