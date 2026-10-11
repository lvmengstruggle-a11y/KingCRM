import { config } from './config/index.js';
import { buildApp } from './app.js';
import { pool } from './support/db.js';

const app = await buildApp();

const close = async () => {
  await app.close();
  await pool.end();
};

process.on('SIGINT', () => {
  void close().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void close().then(() => process.exit(0));
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
