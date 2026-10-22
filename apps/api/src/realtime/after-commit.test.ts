import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { withTransaction } from './after-commit.js';
function database(events: string[]) {
  return { connect: async () => ({ query: async (sql: string) => { events.push(sql); }, release: () => events.push('release') }) } as unknown as Pool;
}
test('emit runs after commit and connection release', async () => {
  const events: string[] = [];
  const value = await withTransaction(database(events), async (_client, afterCommit) => {
    afterCommit(() => { events.push('emit'); }); return 42;
  });
  assert.equal(value, 42);
  assert.deepEqual(events, ['BEGIN', 'COMMIT', 'release', 'emit']);
});
test('rollback never emits', async () => {
  const events: string[] = [];
  await assert.rejects(withTransaction(database(events), async (_client, afterCommit) => {
    afterCommit(() => { events.push('emit'); }); throw new Error('failed bid');
  }));
  assert.deepEqual(events, ['BEGIN', 'ROLLBACK', 'release']);
});
test('failed notification does not reject committed result', async () => {
  assert.equal(await withTransaction(database([]), async (_client, afterCommit) => {
    afterCommit(() => { throw new Error('socket failed'); }); return 42;
  }), 42);
});
