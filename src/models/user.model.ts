import type { RowDataPacket } from 'mysql2';

import { asNumber, asString } from '../support/bit.js';
import { query } from '../support/db.js';

export interface UserRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  language: string | null;
  lastOrganizationId: string | null;
  createTime: number;
  updateTime: number;
  createUser: string;
  updateUser: string;
  avatar: string | null;
}

interface UserRow extends RowDataPacket {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  language: string | null;
  last_organization_id: string | null;
  create_time: number | string;
  update_time: number | string;
  create_user: string;
  update_user: string;
  avatar: string | null;
  password?: string;
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    phone: asString(row.phone),
    email: asString(row.email),
    language: asString(row.language),
    lastOrganizationId: asString(row.last_organization_id),
    createTime: asNumber(row.create_time),
    updateTime: asNumber(row.update_time),
    createUser: row.create_user,
    updateUser: row.update_user,
    avatar: asString(row.avatar),
  };
}

/** 与 ExtUserMapper.selectByPhoneOrEmail 相同：id、手机号、邮箱任一命中。 */
export async function findUserByKey(userKey: string): Promise<UserRecord | null> {
  const rows = await query<UserRow>(
    `SELECT sys_user.id,
            sys_user.name,
            sys_user.phone,
            sys_user.email,
            sys_user.language,
            sys_user.last_organization_id,
            sys_user.create_time,
            sys_user.update_time,
            sys_user.create_user,
            sys_user.update_user,
            sys_user_extend.avatar
     FROM sys_user
              LEFT JOIN sys_user_extend ON sys_user.id = sys_user_extend.id
     WHERE sys_user.id = ? OR sys_user.phone = ? OR sys_user.email = ?
     LIMIT 1`,
    [userKey, userKey, userKey],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function findPassword(userId: string): Promise<string | null> {
  const rows = await query<UserRow>(
    'SELECT password FROM sys_user WHERE id = ? LIMIT 1',
    [userId],
  );
  return rows[0]?.password ?? null;
}

export async function updateLanguage(userId: string, language: string): Promise<void> {
  await query('UPDATE sys_user SET language = ?, update_time = ? WHERE id = ?', [
    language,
    Date.now(),
    userId,
  ]);
}
