import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { createSession, findSessionUser, revokeSession, revokeUserSessions } from './sessions.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required; use a dedicated PostgreSQL test database.');

test('sessions persist only hashes; expiry, current role, disabled state and revoke are authoritative', async t => {
  const schema = `session_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString });
  const db = new pg.Pool({ connectionString, application_name: schema, options: `-c search_path=${schema}` });
  t.after(async () => {
    try { await db.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await db.query(await readFile(new URL('../../../migrations/001_initial.sql', import.meta.url), 'utf8'));
  const user = (await db.query("INSERT INTO users(email,password_hash,display_name) VALUES('session@test.invalid','not-login-capable','Session Test') RETURNING id")).rows[0];
  const other = (await db.query("INSERT INTO users(email,password_hash,display_name) VALUES('other@test.invalid','not-login-capable','Other') RETURNING id")).rows[0];
  const expiry = new Date(Date.now() + 3600000);
  const first = await createSession(db, user.id, expiry);
  const second = await createSession(db, user.id, expiry);
  const unrelated = await createSession(db, other.id, expiry);
  assert.ok(first && second && unrelated);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.expiresAt.getTime(), expiry.getTime());
  const stored = (await db.query('SELECT token_hash FROM sessions WHERE user_id=$1', [user.id])).rows;
  assert.ok(stored.some(row => row.token_hash === createHash('sha256').update(first.token).digest('hex')));
  assert.ok(stored.every(row => row.token_hash !== first.token && row.token_hash !== second.token));
  assert.deepEqual(await findSessionUser(db, first.token), { id: user.id, email: 'session@test.invalid', displayName: 'Session Test', role: 'MEMBER' });
  await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [user.id]);
  assert.equal((await findSessionUser(db, first.token))?.role, 'ADMIN');
  assert.equal(await findSessionUser(db, 'malformed'), null);
  assert.equal(await findSessionUser(db, 'A'.repeat(43)), null);
  await db.query('UPDATE sessions SET expires_at=clock_timestamp() WHERE token_hash=$1', [createHash('sha256').update(first.token).digest('hex')]);
  assert.equal(await findSessionUser(db, first.token), null);
  await db.query('UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1', [user.id]);
  assert.equal(await findSessionUser(db, second.token), null);
  assert.equal(await createSession(db, user.id, expiry), null);
  assert.equal(await createSession(db, randomUUID(), expiry), null);
  await assert.rejects(createSession(db, other.id, new Date(0)), RangeError);
  await assert.rejects(createSession(db, other.id, new Date('invalid')), RangeError);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    assert.equal(await revokeUserSessions(client, user.id), 2);
    await client.query('ROLLBACK');
    assert.equal((await db.query('SELECT * FROM sessions WHERE user_id=$1', [user.id])).rowCount, 2);
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    assert.equal(await revokeUserSessions(client, user.id), 2);
    await client.query('COMMIT');
  } finally { client.release(); }
  assert.equal(await revokeUserSessions(db, user.id), 0);
  assert.ok(await findSessionUser(db, unrelated.token));
  await revokeSession(db, unrelated.token);
  await revokeSession(db, unrelated.token);
  await revokeSession(db, 'malformed');
  assert.equal(await findSessionUser(db, unrelated.token), null);
  assert.equal((await db.query('SELECT * FROM sessions')).rowCount, 0);

  await t.test('issuance waits for a concurrent disable and then refuses the disabled user', async () => {
    await db.query('UPDATE users SET disabled_at=NULL WHERE id=$1', [user.id]);
    const disabling = await db.connect();
    let pending: ReturnType<typeof createSession> | undefined;
    try {
      await disabling.query('BEGIN');
      await disabling.query('UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1', [user.id]);
      pending = createSession(db, user.id, expiry);
      let blocked = false;
      const deadline = Date.now() + 3000;
      while (!blocked && Date.now() < deadline) {
        blocked = (await admin.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid)) > 0) AS blocked`, [schema])).rows[0].blocked;
        if (!blocked) await setTimeout(5);
      }
      assert.ok(blocked, 'session issuance must reach the user row lock');
      await disabling.query('COMMIT');
    } finally {
      await disabling.query('ROLLBACK');
      disabling.release();
      if (pending) assert.equal(await pending, null);
    }
    assert.equal((await db.query('SELECT * FROM sessions')).rowCount, 0);
  });
});
