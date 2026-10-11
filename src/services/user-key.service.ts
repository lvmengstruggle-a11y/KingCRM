import { randomBytes } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';

import { asNumber, bitToBool } from '../support/bit.js';
import { execute, query } from '../support/db.js';
import { failed, notFound } from '../support/errors.js';
import { nextId } from '../support/id.js';

export async function listUserKeys(userId: string) {
  const rows = await query<RowDataPacket & {
    id: string;
    access_key: string;
    secret_key: string;
    create_time: number | string;
    enable: unknown;
    forever: unknown;
    expire_time: number | string | null;
    description: string | null;
    create_user: string;
  }>(
    `SELECT id, create_user, access_key, secret_key, create_time, enable, forever, expire_time, description
     FROM user_key WHERE create_user = ? ORDER BY create_time DESC`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    createUser: row.create_user,
    accessKey: row.access_key,
    secretKey: row.secret_key,
    createTime: asNumber(row.create_time),
    enable: bitToBool(row.enable),
    forever: bitToBool(row.forever),
    expireTime: row.expire_time == null ? null : asNumber(row.expire_time),
    description: row.description ?? '',
  }));
}

export async function addUserKey(userId: string, description?: string) {
  const existing = await query<RowDataPacket & { total: number }>(
    'SELECT COUNT(*) AS total FROM user_key WHERE create_user = ?',
    [userId],
  );
  if (asNumber(existing[0]?.total) >= 5) {
    throw failed('API Key 数量已达上限');
  }
  const id = nextId();
  const accessKey = randomBytes(8).toString('hex');
  const secretKey = randomBytes(16).toString('hex');
  await execute(
    `INSERT INTO user_key (id, create_user, access_key, secret_key, create_time, enable, forever, expire_time, description)
     VALUES (?, ?, ?, ?, ?, 1, 1, NULL, ?)`,
    [id, userId, accessKey, secretKey, Date.now(), description ?? ''],
  );
  return { id, accessKey, secretKey, enable: true, forever: true, description: description ?? '' };
}

export async function deleteUserKey(id: string, userId: string): Promise<void> {
  await execute('DELETE FROM user_key WHERE id = ? AND create_user = ?', [id, userId]);
}

export async function setUserKeyEnable(id: string, userId: string, enable: boolean): Promise<void> {
  await execute('UPDATE user_key SET enable = ? WHERE id = ? AND create_user = ?', [enable ? 1 : 0, id, userId]);
}

export async function updateUserKey(input: {
  id: string;
  userId: string;
  forever: boolean;
  expireTime?: number | null;
  description?: string;
}): Promise<void> {
  const rows = await query<RowDataPacket & { id: string }>(
    'SELECT id FROM user_key WHERE id = ? AND create_user = ? LIMIT 1',
    [input.id, input.userId],
  );
  if (!rows[0]) {
    throw notFound('API Key 不存在');
  }
  if (!input.forever && input.expireTime == null) {
    throw failed('到期时间不能为空');
  }
  await execute(
    'UPDATE user_key SET forever = ?, expire_time = ?, description = ? WHERE id = ? AND create_user = ?',
    [input.forever ? 1 : 0, input.forever ? null : input.expireTime, input.description ?? '', input.id, input.userId],
  );
}
