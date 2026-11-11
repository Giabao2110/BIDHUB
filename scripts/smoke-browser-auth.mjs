import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

// This writes a disposable account. Run only against the isolated CI Compose DB.
if (process.env.BIDHUB_ALLOW_AUTH_SMOKE_WRITE !== '1') throw new Error('Auth smoke requires explicit disposable database opt-in');
const origin = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:8080');
if (!['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('Auth smoke requires a loopback endpoint');
const email = `ci-auth-${randomUUID()}@example.invalid`;
const password = randomUUID();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const page = await browser.newPage();
  await page.goto(origin.origin, { timeout: 10_000 });
  const result = await page.evaluate(async ({ email, password }) => {
    const get = path => fetch('/api/v1/auth/' + path);
    const post = (path, data, token) => fetch('/api/v1/auth/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { 'X-CSRF-Token': token }) },
      body: JSON.stringify(data),
    });
    async function csrf() {
      const response = await get('csrf');
      if (!response.ok) throw new Error(`CSRF bootstrap failed: ${response.status}`);
      return (await response.json()).csrfToken;
    }
    const account = { email, password, displayName: 'CI browser auth' };
    const denied = (await post('register', account)).status;
    const registered = (await post('register', account, await csrf())).status;
    const me = await get('me');
    const firstUser = me.ok ? (await me.json()).user : null;
    const logout = (await post('logout', {}, await csrf())).status;
    const revoked = (await get('me')).status;
    const login = (await post('login', { email, password }, await csrf())).status;
    const restored = await get('me');
    const secondUser = restored.ok ? (await restored.json()).user : null;
    return { denied, registered, me: me.status, logout, revoked, login, restored: restored.status,
      sameMember: Boolean(firstUser && firstUser.id === secondUser?.id && firstUser.email === email && firstUser.role === 'MEMBER') };
  }, { email, password });
  assert.deepEqual(result, { denied: 403, registered: 201, me: 200, logout: 204, revoked: 401, login: 200, restored: 200, sameMember: true });
  console.log('Browser auth smoke passed: CSRF denial, register, session, logout and login');
} finally { await browser.close(); }
