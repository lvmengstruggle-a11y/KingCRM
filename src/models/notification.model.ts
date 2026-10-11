import type { RowDataPacket } from 'mysql2';

import { asNumber } from '../support/bit.js';
import { execute, query, type Tx } from '../support/db.js';
import { nextId } from '../support/id.js';

export interface NotificationRecord {
  id: string;
  type: string;
  receiver: string;
  subject: string;
  status: string;
  operator: string;
  operation: string;
  organizationId: string;
  resourceId: string | null;
  resourceType: string;
  resourceName: string;
  contentText: string;
  createTime: number;
  updateTime: number;
  createUser: string;
  updateUser: string;
}

interface NotificationRow extends RowDataPacket {
  id: string;
  type: string;
  receiver: string;
  subject: string;
  status: string;
  operator: string;
  operation: string;
  organization_id: string;
  resource_id: string | null;
  resource_type: string;
  resource_name: string;
  content: unknown;
  create_time: unknown;
  update_time: unknown;
  create_user: string;
  update_user: string;
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

function mapNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    type: row.type,
    receiver: row.receiver,
    subject: row.subject,
    status: row.status,
    operator: row.operator,
    operation: row.operation,
    organizationId: row.organization_id,
    resourceId: row.resource_id,
    resourceType: row.resource_type,
    resourceName: row.resource_name,
    contentText: blobText(row.content),
    createTime: asNumber(row.create_time),
    updateTime: asNumber(row.update_time),
    createUser: row.create_user,
    updateUser: row.update_user,
  };
}

export async function insertNotifications(tx: Tx, rows: Array<{
  receiver: string;
  subject: string;
  operator: string;
  organizationId: string;
  resourceId: string;
  resourceName: string;
  content: string;
  userId: string;
}>): Promise<void> {
  const now = Date.now();
  for (const row of rows) {
    await tx.execute(
      `INSERT INTO sys_notification
        (id, type, receiver, subject, status, operator, operation, organization_id, resource_id, resource_type,
         resource_name, content, create_time, update_time, create_user, update_user)
       VALUES (?, 'ANNOUNCEMENT_NOTICE', ?, ?, 'UNREAD', ?, 'ANNOUNCEMENT_NOTICE', ?, ?, 'ANNOUNCEMENT_NOTICE', ?, ?, ?, ?, ?, ?)`,
      [
        nextId(),
        row.receiver,
        row.subject,
        row.operator,
        row.organizationId,
        row.resourceId,
        row.resourceName,
        Buffer.from(row.content),
        now,
        now,
        row.userId,
        row.userId,
      ],
    );
  }
}

export async function deleteNotificationsByResource(tx: Tx, resourceId: string): Promise<void> {
  await tx.execute('DELETE FROM sys_notification WHERE resource_id = ?', [resourceId]);
}

export async function listLastNotices(userId: string, organizationId: string): Promise<NotificationRecord[]> {
  const rows = await query<NotificationRow>(
    `SELECT * FROM sys_notification
     WHERE receiver = ? AND organization_id = ? AND status = 'UNREAD' AND resource_type <> 'ANNOUNCEMENT_NOTICE'
     ORDER BY create_time DESC LIMIT 20`,
    [userId, organizationId],
  );
  return rows.map(mapNotification);
}

export async function listLastAnnouncements(userId: string, organizationId: string): Promise<NotificationRecord[]> {
  const rows = await query<NotificationRow>(
    `SELECT * FROM sys_notification
     WHERE receiver = ? AND organization_id = ? AND status = 'UNREAD' AND resource_type = 'ANNOUNCEMENT_NOTICE'
     ORDER BY create_time DESC`,
    [userId, organizationId],
  );
  return rows.map(mapNotification);
}

export async function pageNotifications(input: {
  userId: string;
  organizationId: string;
  type?: string;
  status?: string;
  resourceType?: string;
  createTime?: number | null;
  endTime?: number | null;
  current: number;
  pageSize: number;
}): Promise<{ list: NotificationRecord[]; total: number }> {
  const where = ['receiver = ?', 'organization_id = ?'];
  const params: unknown[] = [input.userId, input.organizationId];
  if (input.type) {
    where.push('type = ?');
    params.push(input.type);
  }
  if (input.status) {
    where.push('status = ?');
    params.push(input.status);
  }
  if (input.resourceType) {
    where.push('resource_type = ?');
    params.push(input.resourceType);
  }
  if (input.createTime) {
    where.push('create_time >= ?');
    params.push(input.createTime);
  }
  if (input.endTime) {
    where.push('create_time <= ?');
    params.push(input.endTime);
  }
  const whereSql = where.join(' AND ');
  const countRows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM sys_notification WHERE ${whereSql}`,
    params,
  );
  const rows = await query<NotificationRow>(
    `SELECT * FROM sys_notification WHERE ${whereSql} ORDER BY create_time DESC LIMIT ? OFFSET ?`,
    [...params, input.pageSize, (input.current - 1) * input.pageSize],
  );
  return { list: rows.map(mapNotification), total: asNumber(countRows[0]?.total) };
}

export async function countUnreadByResource(userId: string, organizationId: string): Promise<Array<{ key: string; count: number }>> {
  const rows = await query<RowDataPacket & { resource_type: string; total: number }>(
    `SELECT resource_type, COUNT(*) AS total
     FROM sys_notification
     WHERE receiver = ? AND organization_id = ? AND status = 'UNREAD'
     GROUP BY resource_type`,
    [userId, organizationId],
  );
  const options = rows.map((row) => ({ key: row.resource_type, count: asNumber(row.total) }));
  const total = options.reduce((sum, item) => sum + item.count, 0);
  return [{ key: 'total', count: total }, ...options];
}

export async function markNotificationRead(id: string, userId: string, organizationId: string): Promise<number> {
  const rows = await query<RowDataPacket & { id: string }>(
    `SELECT id FROM sys_notification WHERE id = ? AND receiver = ? AND organization_id = ? AND status = 'UNREAD' LIMIT 1`,
    [id, userId, organizationId],
  );
  if (!rows[0]) {
    return 0;
  }
  await execute(
    `UPDATE sys_notification SET status = 'READ', update_time = ?, update_user = ? WHERE id = ?`,
    [Date.now(), userId, id],
  );
  return 1;
}

export async function markAllNotificationsRead(userId: string, organizationId: string): Promise<number> {
  const rows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM sys_notification
     WHERE receiver = ? AND organization_id = ? AND status = 'UNREAD'`,
    [userId, organizationId],
  );
  const total = asNumber(rows[0]?.total);
  if (total === 0) {
    return 0;
  }
  await execute(
    `UPDATE sys_notification SET status = 'READ', update_time = ?, update_user = ?
     WHERE receiver = ? AND organization_id = ? AND status = 'UNREAD'`,
    [Date.now(), userId, userId, organizationId],
  );
  return total;
}
