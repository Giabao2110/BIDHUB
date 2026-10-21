const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
export const env = {
  port,
  host: process.env.HOST ?? '127.0.0.1',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL,
};
