import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './database/pool.js';
import { registerAuctionRooms } from './realtime/auction-rooms.js';
import { createAuctionPublisher } from './realtime/publisher.js';
import { log } from './observability/logger.js';
import { processAuctionLifecycle, startAuctionLifecycle } from './jobs/auction-lifecycle.js';
import { metrics, metricsServer } from './observability/metrics.js';
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: env.webOrigin }, maxHttpBufferSize: 4096,
  allowRequest: (req, callback) => callback(null, req.headers.origin === env.webOrigin),
});
registerAuctionRooms(io, async id => {
  const result = await pool.query("SELECT 1 FROM auctions WHERE id=$1 AND status <> 'DRAFT'", [id]);
  return result.rowCount === 1;
});
// Bid/close services call this through withTransaction's afterCommit callback.
// Inject the returned publisher into services at composition time; services must
// import publisher.ts, NOT server.ts (which starts the HTTP server).
const publishAuctionUpdate = createAuctionPublisher(io);
metrics.registerRuntime(() => ({total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, sockets: io.engine.clientsCount}));
const monitoring = metricsServer(metrics.registry);
monitoring.listen(env.metricsPort, env.host);
const stopLifecycle = startAuctionLifecycle(() => metrics.runLifecycle(() => processAuctionLifecycle(pool, publishAuctionUpdate)));
server.listen(env.port, env.host, () => log('server_started', { port: env.port, host: env.host }));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  monitoring.close();
  io.close(() => {
    void stopLifecycle().then(() => pool.end()).then(() => { metrics.registry.clear(); clearTimeout(deadline); log('server_stopped'); });
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
