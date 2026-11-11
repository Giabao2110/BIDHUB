import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { TestContext } from 'node:test';
import pg from 'pg';
import { runMigrations } from '../src/database/migrations.js';

export async function startTestApi(t: TestContext, webOrigin = 'http://localhost:5173') {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required; use a dedicated PostgreSQL test database.');

  const schema = `http_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString, connectionTimeoutMillis: 3000 });
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const db = new pg.Pool({ connectionString: url.toString(), connectionTimeoutMillis: 3000 });
  t.after(async () => {
    try {
      await db.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await runMigrations(db);

  process.env.DATABASE_URL = url.toString();
  process.env.WEB_ORIGIN = webOrigin;
  delete process.env.TRUST_WEB_PROXY;
  const { app } = await import('../src/app.js');
  const { pool } = await import('../src/database/pool.js');
  t.after(() => pool.end());
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const request = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, init);

  function client() {
    const cookies = new Map<string, string>();
    async function send(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (!headers.has('origin')) headers.set('Origin', webOrigin);
      if (init.body !== undefined) headers.set('Content-Type', 'application/json');
      if (!headers.has('cookie') && cookies.size) {
        headers.set('Cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
      }
      const response = await request(path, { ...init, headers });
      for (const header of response.headers.getSetCookie()) {
        const [name, value] = header.split(';', 1)[0].split('=');
        if (value) cookies.set(name, value);
        else cookies.delete(name);
      }
      return response;
    }

    async function csrf(): Promise<string> {
      const response = await send('/auth/csrf');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const { csrfToken } = await response.json();
      assert.match(csrfToken, /^[A-Za-z0-9_-]{43}$/);
      return csrfToken;
    }

    return {
      cookies,
      send,
      csrf,
      async write(path: string, method: string, body?: unknown) {
        return send(path, {
          method,
          headers: { 'X-CSRF-Token': await csrf() },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      },
    };
  }

  return { db, request, client };
}

export async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  const { error } = await response.json();
  assert.equal(error.code, code);
  assert.ok(error.message);
  assert.ok(error.requestId);
  assert.equal(error.requestId, response.headers.get('x-request-id'));
  return error.message as string;
}
