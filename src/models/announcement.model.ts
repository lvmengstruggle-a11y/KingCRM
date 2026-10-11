import type { RowDataPacket } from 'mysql2';

import { asNumber, bitToBool } from '../support/bit.js';
import { query, type Tx } from '../support/db.js';
import { nextId } from '../support/id.js';

export interface AnnouncementRecord {
  id: string;
  subject: string;
  content: string;
  startTime: number;
  endTime: number;
  url: string | null;
  renameUrl: string | null;
  organizationId: string;
  notice: boolean;
  createTime: number;
  updateTime: number;
  createUser: string;
  updateUser: string;
  createUserName: string | null;
  updateUserName: string | null;
  receiveType: string;
}

interface AnnouncementRow extends RowDataPacket {
  id: string;
  subject: string;
  content: unknown;
  start_time: unknown;
  end_time: unknown;
  url: string | null;
  rename_url: string | null;
  organization_id: string;
  notice: unknown;
  create_time: unknown;
  update_time: unknown;
  create_user: string;
  update_user: string;
  createUserName?: string | null;
  updateUserName?: string | null;
  receive_type: unknown;
}

function blobText(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

function mapAnnouncement(row: AnnouncementRow): AnnouncementRecord {
  return {
    id: row.id,
    subject: row.subject,
    content: blobText(row.content),
    startTime: asNumber(row.start_time),
    endTime: asNumber(row.end_time),
    url: row.url,
    renameUrl: row.rename_url,
    organizationId: row.organization_id,
    notice: bitToBool(row.notice),
    createTime: asNumber(row.create_time),
    updateTime: asNumber(row.update_time),
    createUser: row.create_user,
    updateUser: row.update_user,
    createUserName: row.createUserName ?? null,
    updateUserName: row.updateUserName ?? null,
    receiveType: blobText(row.receive_type),
  };
}

const SORT_COLUMNS: Record<string, string> = {
  startTime: 'a.start_time',
  createTime: 'a.create_time',
  updateTime: 'a.update_time',
  createUser: 'a.create_user',
  updateUser: 'a.update_user',
  subject: 'a.subject',
};

export async function pageAnnouncements(input: {
  organizationId: string;
  keyword?: string;
  current: number;
  pageSize: number;
  sortName?: string;
  sortType?: string;
}): Promise<{ list: AnnouncementRecord[]; total: number }> {
  const where = ['a.organization_id = ?'];
  const params: unknown[] = [input.organizationId];
  if (input.keyword) {
    where.push('a.subject LIKE ?');
    params.push(`%${input.keyword}%`);
  }
  const whereSql = where.join(' AND ');
  const countRows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM sys_announcement a WHERE ${whereSql}`,
    params,
  );
  const column = SORT_COLUMNS[input.sortName ?? ''] ?? 'a.create_time';
  const direction = input.sortType?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const rows = await query<AnnouncementRow>(
    `SELECT a.*, cu.name AS createUserName, uu.name AS updateUserName
     FROM sys_announcement a
     LEFT JOIN sys_user cu ON cu.id = a.create_user
     LEFT JOIN sys_user uu ON uu.id = a.update_user
     WHERE ${whereSql}
     ORDER BY ${column} ${direction}
     LIMIT ? OFFSET ?`,
    [...params, input.pageSize, (input.current - 1) * input.pageSize],
  );
  return {
    list: rows.map(mapAnnouncement),
    total: asNumber(countRows[0]?.total),
  };
}

export async function findAnnouncement(id: string): Promise<AnnouncementRecord | null> {
  const rows = await query<AnnouncementRow>('SELECT * FROM sys_announcement WHERE id = ? LIMIT 1', [id]);
  return rows[0] ? mapAnnouncement(rows[0]) : null;
}

export async function insertAnnouncement(tx: Tx, input: {
  organizationId: string;
  subject: string;
  content: string;
  startTime: number;
  endTime: number;
  url: string;
  renameUrl: string;
  receiverIds: string[];
  receiveType: string;
  notice: boolean;
  userId: string;
}): Promise<string> {
  const id = nextId();
  const now = Date.now();
  await tx.execute(
    `INSERT INTO sys_announcement
      (id, subject, content, start_time, end_time, url, rename_url, receiver, organization_id, notice,
       create_time, update_time, create_user, update_user, receive_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.subject,
      Buffer.from(input.content),
      input.startTime,
      input.endTime,
      input.url || null,
      input.renameUrl || null,
      Buffer.from(JSON.stringify(input.receiverIds)),
      input.organizationId,
      input.notice ? 1 : 0,
      now,
      now,
      input.userId,
      input.userId,
      Buffer.from(input.receiveType),
    ],
  );
  return id;
}

export async function updateAnnouncement(tx: Tx, input: {
  id: string;
  subject: string;
  content: string;
  startTime: number;
  endTime: number;
  url: string;
  renameUrl: string;
  receiverIds: string[];
  receiveType: string;
  notice: boolean;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await tx.execute(
    `UPDATE sys_announcement
     SET subject = ?, content = ?, start_time = ?, end_time = ?, url = ?, rename_url = ?,
         receiver = ?, receive_type = ?, organization_id = ?, notice = ?, update_time = ?, update_user = ?
     WHERE id = ?`,
    [
      input.subject,
      Buffer.from(input.content),
      input.startTime,
      input.endTime,
      input.url || null,
      input.renameUrl || null,
      Buffer.from(JSON.stringify(input.receiverIds)),
      Buffer.from(input.receiveType),
      input.organizationId,
      input.notice ? 1 : 0,
      Date.now(),
      input.userId,
      input.id,
    ],
  );
}

export async function deleteAnnouncement(tx: Tx, id: string): Promise<void> {
  await tx.execute('DELETE FROM sys_announcement WHERE id = ?', [id]);
}

export async function listNames(table: 'sys_user' | 'sys_department', ids: string[]): Promise<Array<{ id: string; name: string }>> {
  if (ids.length === 0) {
    return [];
  }
  const marks = ids.map(() => '?').join(',');
  const rows = await query<RowDataPacket & { id: string; name: string }>(
    `SELECT id, name FROM ${table} WHERE id IN (${marks})`,
    ids,
  );
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function listUserIdsByDepartments(organizationId: string, departmentIds: string[]): Promise<string[]> {
  if (departmentIds.length === 0) {
    return [];
  }
  const marks = departmentIds.map(() => '?').join(',');
  const rows = await query<RowDataPacket & { user_id: string }>(
    `SELECT user_id FROM sys_organization_user WHERE organization_id = ? AND department_id IN (${marks})`,
    [organizationId, ...departmentIds],
  );
  return rows.map((row) => row.user_id);
}
