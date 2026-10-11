import dotenv from 'dotenv';

dotenv.config();

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: readNumber('PORT', 8083),
  sessionTtlMs: readNumber('SESSION_TTL_MS', 30 * 24 * 60 * 60 * 1000),
  crmVersion: process.env.CRM_VERSION || 'node-0.1.0',
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: readNumber('MYSQL_PORT', 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'kingcrm',
  },
};

export const ADMIN_USER_ID = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'KingCRM';
