import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { config } from '../config/index.js';
import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  enableKeepAlive: true,
});

export type SqlRow = RowDataPacket;

export interface Tx {
  query<T extends SqlRow>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export async function query<T extends SqlRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query<T[]>(sql, params);
  return rows;
}

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  await pool.query(sql, params);
}

export async function withTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(createTx(connection));
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function createTx(connection: PoolConnection): Tx {
  return {
    async query<T extends SqlRow>(sql: string, params: unknown[] = []): Promise<T[]> {
      const [rows] = await connection.query<T[]>(sql, params);
      return rows;
    },
    async execute(sql: string, params: unknown[] = []): Promise<void> {
      await connection.query<ResultSetHeader>(sql, params);
    },
  };
}
