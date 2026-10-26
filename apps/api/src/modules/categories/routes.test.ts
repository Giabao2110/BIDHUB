import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required; use a dedicated PostgreSQL test database.');

test('public category HTTP endpoint returns only contract fields in stable order and sanitizes DB errors', async t => {
  const schema = `category_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString });
  const db = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  t.after(async () => {
    try { await db.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await db.query(await readFile(new URL('../../../migrations/001_initial.sql', import.meta.url), 'utf8'));
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.toString();
  const { app } = await import('../../app.js');
  const { pool } = await import('../../database/pool.js');
  t.after(async () => {
    await pool.end();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/v1/categories`;
  const empty = await fetch(base);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { items: [] });
  const a = randomUUID(), z = randomUUID();
  await db.query("INSERT INTO categories(id,slug,name) VALUES($1,'z-category','Last'),($2,'a-category','First')", [z, a]);
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  const expected = { items: [{ id: a, slug: 'a-category', name: 'First' }, { id: z, slug: 'z-category', name: 'Last' }] };
  assert.deepEqual(await response.json(), expected);
  assert.deepEqual(await (await fetch(base + '?sellerId=ignored&sort=DROP%20TABLE%20categories')).json(), expected);
  const missing = await fetch(base + '/missing');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json() as { error: { code: string } }).error.code, 'NOT_FOUND');
  await db.query('ALTER TABLE categories RENAME TO hidden_categories');
  const failed = await fetch(base);
  assert.equal(failed.status, 500);
  const error = await failed.json() as { error: { code: string; message: string; requestId: string } };
  assert.equal(error.error.code, 'INTERNAL_ERROR');
  assert.equal(error.error.message, 'Unexpected server error');
  assert.equal(error.error.requestId, failed.headers.get('x-request-id'));
  assert.ok(error.error.requestId);
  assert.ok(!JSON.stringify(error).includes(schema));
});
