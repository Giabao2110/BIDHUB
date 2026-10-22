import test from 'node:test';
import assert from 'node:assert/strict';
import { startAuctionLifecycle } from './auction-lifecycle.js';
test('startup tick runs immediately; stopping waits for in-flight work and prevents next tick', async () => {
  let finish!: () => void;
  let count = 0;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const stop = startAuctionLifecycle(async () => { count++; await pending; return 0; }, 1);
  assert.equal(count, 1);
  let stopped = false;
  const stopping = stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  finish();
  await stopping;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(count, 1);
});
