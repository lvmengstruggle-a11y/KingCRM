import type { RowDataPacket } from 'mysql2';

import { asNumber } from '../support/bit.js';
import { query, type Tx } from '../support/db.js';
import { nextId } from '../support/id.js';

export interface TicketRecord {
  id: string;
  organizationId: string;
  number: string;
  title: string;
  templateId: string;
  statusId: string;
  priority: number;
  publisherId: string;
  recipientId: string | null;
  handlerId: string | null;
  departmentId: string | null;
  customerId: string | null;
  contractId: string | null;
  orderId: string | null;
  mobile: string | null;
  mail: string | null;
  guestName: string | null;
  source: string;
  deadline: number | null;
  endTime: number | null;
  recycled: boolean;
  recycleUser: string | null;
  recycleTime: number | null;
  createTime: number;
  updateTime: number;
  createUser: string;
  updateUser: string;
  statusName?: string;
  statusColor?: string;
  publisherName?: string;
  handlerName?: string;
  departmentName?: string;
  customerName?: string;
  templateName?: string;
  satisfyScore?: number | null;
}

export interface TicketListFilter {
  organizationId: string;
  view: 'all' | 'mine' | 'handling' | 'department' | 'cc' | 'recycle';
  userId: string;
  departmentId: string | null;
  scopeAll: boolean;
  scopeDepartmentIds: string[];
  keyword: string;
  statusId: string;
  priority: number;
  templateId: string;
  handlerId: string;
  customerId: string;
  current: number;
  pageSize: number;
}

export interface ModuleFieldValue {
  fieldId: string;
  fieldValue: string;
}

function mapTicket(row: RowDataPacket): TicketRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    number: row.number,
    title: row.title,
    templateId: row.template_id,
    statusId: row.status_id,
    priority: asNumber(row.priority),
    publisherId: row.publisher_id,
    recipientId: row.recipient_id,
    handlerId: row.handler_id,
    departmentId: row.department_id,
    customerId: row.customer_id,
    contractId: row.contract_id,
    orderId: row.order_id,
    mobile: row.mobile,
    mail: row.mail,
    guestName: row.guest_name ?? null,
    source: row.source,
    deadline: row.deadline == null ? null : asNumber(row.deadline),
    endTime: row.end_time == null ? null : asNumber(row.end_time),
    recycled: Number(row.recycled) === 1,
    recycleUser: row.recycle_user,
    recycleTime: row.recycle_time == null ? null : asNumber(row.recycle_time),
    createTime: asNumber(row.create_time),
    updateTime: asNumber(row.update_time),
    createUser: row.create_user,
    updateUser: row.update_user,
    statusName: row.status_name ?? undefined,
    statusColor: row.status_color ?? undefined,
    publisherName: row.publisher_name || row.guest_name || undefined,
    handlerName: row.handler_name ?? undefined,
    departmentName: row.department_name ?? undefined,
    customerName: row.customer_name ?? undefined,
    templateName: row.template_name ?? undefined,
    satisfyScore: row.satisfy_score == null ? null : asNumber(row.satisfy_score),
  };
}

const LIST_FROM = `
  FROM ticket t
  LEFT JOIN ticket_status st ON st.id = t.status_id
  LEFT JOIN ticket_template tp ON tp.id = t.template_id
  LEFT JOIN sys_user pu ON pu.id = t.publisher_id
  LEFT JOIN sys_user hu ON hu.id = t.handler_id
  LEFT JOIN sys_department d ON d.id = t.department_id
  LEFT JOIN customer c ON c.id = t.customer_id
  LEFT JOIN ticket_satisfy ss ON ss.ticket_id = t.id
`;

function listWhere(filter: TicketListFilter): { sql: string; params: unknown[] } {
  const where = ['t.organization_id = ?'];
  const params: unknown[] = [filter.organizationId];
  if (filter.view === 'recycle') {
    where.push('t.recycled = 1');
  } else {
    where.push('t.recycled = 0');
  }
  if (filter.view === 'mine') {
    where.push('t.publisher_id = ?');
    params.push(filter.userId);
  } else if (filter.view === 'handling') {
    where.push('t.handler_id = ?');
    where.push('t.end_time IS NULL');
    params.push(filter.userId);
  } else if (filter.view === 'department') {
    where.push('t.department_id = ?');
    params.push(filter.departmentId ?? '');
  } else if (filter.view === 'cc') {
    where.push('t.id IN (SELECT ticket_id FROM ticket_cc WHERE organization_id = ? AND user_id = ?)');
    params.push(filter.organizationId, filter.userId);
  } else if (!filter.scopeAll) {
    const related = [
      't.publisher_id = ?',
      't.handler_id = ?',
      't.recipient_id = ?',
      't.id IN (SELECT ticket_id FROM ticket_cc WHERE organization_id = ? AND user_id = ?)',
      't.id IN (SELECT ticket_id FROM ticket_participant WHERE organization_id = ? AND user_id = ?)',
    ];
    const relatedParams: unknown[] = [
      filter.userId, filter.userId, filter.userId,
      filter.organizationId, filter.userId,
      filter.organizationId, filter.userId,
    ];
    if (filter.scopeDepartmentIds.length > 0) {
      related.push(`t.department_id IN (${filter.scopeDepartmentIds.map(() => '?').join(',')})`);
      relatedParams.push(...filter.scopeDepartmentIds);
    }
    where.push(`(${related.join(' OR ')})`);
    params.push(...relatedParams);
  }
  if (filter.keyword) {
    where.push('(t.title LIKE ? OR t.number LIKE ?)');
    params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
  }
  if (filter.statusId) {
    where.push('t.status_id = ?');
    params.push(filter.statusId);
  }
  if (filter.priority > 0) {
    where.push('t.priority = ?');
    params.push(filter.priority);
  }
  if (filter.templateId) {
    where.push('t.template_id = ?');
    params.push(filter.templateId);
  }
  if (filter.handlerId) {
    where.push('t.handler_id = ?');
    params.push(filter.handlerId);
  }
  if (filter.customerId) {
    where.push('t.customer_id = ?');
    params.push(filter.customerId);
  }
  return { sql: where.join(' AND '), params };
}

export async function pageTickets(filter: TicketListFilter): Promise<{ list: TicketRecord[]; total: number }> {
  const where = listWhere(filter);
  const countRows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total ${LIST_FROM} WHERE ${where.sql}`,
    where.params,
  );
  const rows = await query<RowDataPacket>(
    `SELECT t.*, st.name AS status_name, st.color AS status_color, tp.name AS template_name,
            pu.name AS publisher_name, hu.name AS handler_name, d.name AS department_name, c.name AS customer_name,
            ss.score AS satisfy_score
     ${LIST_FROM}
     WHERE ${where.sql}
     ORDER BY t.create_time DESC
     LIMIT ? OFFSET ?`,
    [...where.params, filter.pageSize, (filter.current - 1) * filter.pageSize],
  );
  return { list: rows.map(mapTicket), total: asNumber(countRows[0]?.total) };
}

export async function findTicketByNumber(organizationId: string, number: string): Promise<TicketRecord | null> {
  const rows = await query<RowDataPacket>(
    `SELECT t.*, st.name AS status_name, st.color AS status_color, ss.score AS satisfy_score
     FROM ticket t
     LEFT JOIN ticket_status st ON st.id = t.status_id
     LEFT JOIN ticket_satisfy ss ON ss.ticket_id = t.id
     WHERE t.organization_id = ? AND t.number = ? LIMIT 1`,
    [organizationId, number],
  );
  return rows[0] ? mapTicket(rows[0]) : null;
}

export async function findTicket(id: string, organizationId: string, tx?: Tx): Promise<TicketRecord | null> {
  const rows = await (tx ?? { query }).query<RowDataPacket>(
    `SELECT t.*, st.name AS status_name, st.color AS status_color, tp.name AS template_name,
            pu.name AS publisher_name, hu.name AS handler_name, d.name AS department_name, c.name AS customer_name,
            ss.score AS satisfy_score
     ${LIST_FROM}
     WHERE t.id = ? AND t.organization_id = ? LIMIT 1`,
    [id, organizationId],
  );
  return rows[0] ? mapTicket(rows[0]) : null;
}

export async function lockTicket(tx: Tx, id: string, organizationId: string): Promise<TicketRecord | null> {
  const rows = await tx.query<RowDataPacket>(
    'SELECT * FROM ticket WHERE id = ? AND organization_id = ? LIMIT 1 FOR UPDATE',
    [id, organizationId],
  );
  return rows[0] ? mapTicket(rows[0]) : null;
}

export async function numberExists(tx: Tx, organizationId: string, number: string): Promise<boolean> {
  const rows = await tx.query<RowDataPacket>(
    'SELECT id FROM ticket WHERE organization_id = ? AND number = ? LIMIT 1',
    [organizationId, number],
  );
  return Boolean(rows[0]);
}

export async function insertTicket(tx: Tx, row: TicketRecord): Promise<void> {
  await tx.execute(
    `INSERT INTO ticket
      (id, organization_id, number, title, template_id, status_id, priority, publisher_id, recipient_id, handler_id,
       department_id, customer_id, contract_id, order_id, mobile, mail, guest_name, source, deadline, end_time, recycled,
       create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?)`,
    [
      row.id, row.organizationId, row.number, row.title, row.templateId, row.statusId, row.priority, row.publisherId,
      row.recipientId, row.handlerId, row.departmentId, row.customerId, row.contractId, row.orderId, row.mobile, row.mail,
      row.guestName, row.source, row.deadline, row.createTime, row.updateTime, row.createUser, row.updateUser,
    ],
  );
}

export async function updateTicketAssign(tx: Tx, id: string, departmentId: string | null, handlerId: string | null, recipientId: string | null, userId: string, now: number): Promise<void> {
  await tx.execute(
    `UPDATE ticket SET department_id = ?, handler_id = ?, recipient_id = ?, update_time = ?, update_user = ? WHERE id = ?`,
    [departmentId, handlerId, recipientId, now, userId, id],
  );
}

export async function updateTicketBody(tx: Tx, row: Pick<TicketRecord, 'id' | 'title' | 'priority' | 'customerId' | 'mobile' | 'mail' | 'deadline'>, userId: string, now: number): Promise<void> {
  await tx.execute(
    `UPDATE ticket SET title = ?, priority = ?, customer_id = ?, mobile = ?, mail = ?, deadline = ?, update_time = ?, update_user = ? WHERE id = ?`,
    [row.title, row.priority, row.customerId, row.mobile, row.mail, row.deadline, now, userId, row.id],
  );
}

export async function updateTicketPriority(tx: Tx, id: string, priority: number, userId: string, now: number): Promise<void> {
  await tx.execute(
    'UPDATE ticket SET priority = ?, update_time = ?, update_user = ? WHERE id = ?',
    [priority, now, userId, id],
  );
}

export async function updateTicketStatus(tx: Tx, id: string, statusId: string, endTime: number | null, userId: string, now: number): Promise<void> {
  await tx.execute(
    'UPDATE ticket SET status_id = ?, end_time = ?, update_time = ?, update_user = ? WHERE id = ?',
    [statusId, endTime, now, userId, id],
  );
}

export async function markRecycled(tx: Tx, id: string, recycled: boolean, userId: string, now: number): Promise<void> {
  await tx.execute(
    `UPDATE ticket SET recycled = ?, recycle_user = ?, recycle_time = ?, update_time = ?, update_user = ? WHERE id = ?`,
    [recycled ? 1 : 0, recycled ? userId : null, recycled ? now : null, now, userId, id],
  );
}

export async function replaceFields(tx: Tx, ticketId: string, values: ModuleFieldValue[], blobIds: Set<string>): Promise<void> {
  await tx.execute('DELETE FROM ticket_field WHERE resource_id = ?', [ticketId]);
  await tx.execute('DELETE FROM ticket_field_blob WHERE resource_id = ?', [ticketId]);
  for (const value of values) {
    const table = blobIds.has(value.fieldId) ? 'ticket_field_blob' : 'ticket_field';
    await tx.execute(
      `INSERT INTO ${table} (id, resource_id, field_id, field_value) VALUES (?, ?, ?, ?)`,
      [nextId(), ticketId, value.fieldId, value.fieldValue],
    );
  }
}

export async function listFields(ticketId: string): Promise<ModuleFieldValue[]> {
  const shortRows = await query<RowDataPacket>(
    'SELECT field_id, field_value FROM ticket_field WHERE resource_id = ?',
    [ticketId],
  );
  const longRows = await query<RowDataPacket>(
    'SELECT field_id, field_value FROM ticket_field_blob WHERE resource_id = ?',
    [ticketId],
  );
  return [...shortRows, ...longRows].map((row) => ({
    fieldId: row.field_id,
    fieldValue: row.field_value == null ? '' : String(row.field_value),
  }));
}

export async function addParticipant(tx: Tx, organizationId: string, ticketId: string, userId: string, operator: string, now: number): Promise<void> {
  const rows = await tx.query<RowDataPacket>(
    'SELECT id FROM ticket_participant WHERE ticket_id = ? AND user_id = ? LIMIT 1',
    [ticketId, userId],
  );
  if (rows[0]) {
    return;
  }
  await tx.execute(
    `INSERT INTO ticket_participant
      (id, organization_id, ticket_id, user_id, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [nextId(), organizationId, ticketId, userId, now, now, operator, operator],
  );
}

export async function replaceCc(tx: Tx, organizationId: string, ticketId: string, userIds: string[], operator: string, now: number): Promise<void> {
  await tx.execute('DELETE FROM ticket_cc WHERE ticket_id = ?', [ticketId]);
  for (const userId of userIds) {
    await tx.execute(
      `INSERT INTO ticket_cc
        (id, organization_id, ticket_id, user_id, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nextId(), organizationId, ticketId, userId, now, now, operator, operator],
    );
  }
}

export async function listCc(ticketId: string): Promise<Array<{ userId: string; name: string }>> {
  const rows = await query<RowDataPacket>(
    `SELECT c.user_id, u.name FROM ticket_cc c LEFT JOIN sys_user u ON u.id = c.user_id WHERE c.ticket_id = ?`,
    [ticketId],
  );
  return rows.map((row) => ({ userId: row.user_id, name: row.name ?? '' }));
}

export async function isRelated(ticketId: string, userId: string, organizationId: string): Promise<boolean> {
  const rows = await query<RowDataPacket>(
    `SELECT 1 AS ok FROM ticket_cc WHERE ticket_id = ? AND user_id = ? AND organization_id = ?
     UNION SELECT 1 FROM ticket_participant WHERE ticket_id = ? AND user_id = ? AND organization_id = ? LIMIT 1`,
    [ticketId, userId, organizationId, ticketId, userId, organizationId],
  );
  return Boolean(rows[0]);
}

export async function insertReply(tx: Tx, input: { id: string; organizationId: string; ticketId: string; userId: string; content: string; now: number }): Promise<void> {
  await tx.execute(
    `INSERT INTO ticket_reply
      (id, organization_id, ticket_id, user_id, content, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.id, input.organizationId, input.ticketId, input.userId, input.content, input.now, input.now, input.userId, input.userId],
  );
}

export async function listReplies(ticketId: string): Promise<Array<{ id: string; userId: string; userName: string; content: string; createTime: number }>> {
  const rows = await query<RowDataPacket>(
    `SELECT r.*, u.name AS user_name FROM ticket_reply r LEFT JOIN sys_user u ON u.id = r.user_id
     WHERE r.ticket_id = ? ORDER BY r.create_time`,
    [ticketId],
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? '',
    content: row.content,
    createTime: asNumber(row.create_time),
  }));
}

export async function insertInternalReply(tx: Tx, input: { id: string; organizationId: string; ticketId: string; userId: string; content: string; mentionUserIds: string; now: number }): Promise<void> {
  await tx.execute(
    `INSERT INTO ticket_internal_reply
      (id, organization_id, ticket_id, user_id, content, mention_user_ids, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.id, input.organizationId, input.ticketId, input.userId, input.content, input.mentionUserIds, input.now, input.now, input.userId, input.userId],
  );
}

export async function listInternalReplies(ticketId: string): Promise<Array<{ id: string; userId: string; userName: string; content: string; mentionUserIds: string[]; createTime: number }>> {
  const rows = await query<RowDataPacket>(
    `SELECT r.*, u.name AS user_name FROM ticket_internal_reply r LEFT JOIN sys_user u ON u.id = r.user_id
     WHERE r.ticket_id = ? ORDER BY r.create_time`,
    [ticketId],
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? '',
    content: row.content,
    mentionUserIds: String(row.mention_user_ids ?? '').split(',').filter(Boolean),
    createTime: asNumber(row.create_time),
  }));
}

export async function insertEvent(tx: Tx, input: {
  organizationId: string;
  ticketId: string;
  userId: string;
  eventType: string;
  replyId?: string | null;
  statusId?: string | null;
  priority?: number | null;
  targetUserId?: string | null;
  content?: string;
  now: number;
}): Promise<void> {
  await tx.execute(
    `INSERT INTO ticket_event
      (id, organization_id, ticket_id, user_id, event_type, reply_id, status_id, priority, target_user_id, content,
       create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nextId(), input.organizationId, input.ticketId, input.userId, input.eventType, input.replyId ?? null,
      input.statusId ?? null, input.priority ?? null, input.targetUserId ?? null, input.content ?? '',
      input.now, input.now, input.userId, input.userId,
    ],
  );
}

export async function listEvents(ticketId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await query<RowDataPacket>(
    `SELECT e.*, u.name AS user_name FROM ticket_event e LEFT JOIN sys_user u ON u.id = e.user_id
     WHERE e.ticket_id = ? ORDER BY e.create_time`,
    [ticketId],
  );
  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    userId: row.user_id,
    userName: row.user_name ?? '',
    statusId: row.status_id,
    priority: row.priority,
    targetUserId: row.target_user_id,
    content: row.content,
    createTime: asNumber(row.create_time),
  }));
}

export async function listFollowers(ticketId: string): Promise<string[]> {
  const rows = await query<RowDataPacket & { user_id: string }>(
    'SELECT user_id FROM ticket_follow WHERE ticket_id = ?',
    [ticketId],
  );
  return rows.map((row) => row.user_id);
}

export async function isFollowed(ticketId: string, userId: string): Promise<boolean> {
  const rows = await query<RowDataPacket>(
    'SELECT id FROM ticket_follow WHERE ticket_id = ? AND user_id = ? LIMIT 1',
    [ticketId, userId],
  );
  return Boolean(rows[0]);
}

export async function setFollow(tx: Tx, organizationId: string, ticketId: string, userId: string, follow: boolean, now: number): Promise<void> {
  if (!follow) {
    await tx.execute('DELETE FROM ticket_follow WHERE ticket_id = ? AND user_id = ?', [ticketId, userId]);
    return;
  }
  const rows = await tx.query<RowDataPacket>(
    'SELECT id FROM ticket_follow WHERE ticket_id = ? AND user_id = ? LIMIT 1',
    [ticketId, userId],
  );
  if (rows[0]) {
    return;
  }
  await tx.execute(
    `INSERT INTO ticket_follow
      (id, organization_id, ticket_id, user_id, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [nextId(), organizationId, ticketId, userId, now, now, userId, userId],
  );
}

export async function listFiles(ticketId: string): Promise<Array<{ id: string; fileId: string; fileName: string; replyId: string | null; internalReplyId: string | null }>> {
  const rows = await query<RowDataPacket>(
    'SELECT * FROM ticket_file WHERE ticket_id = ? ORDER BY create_time',
    [ticketId],
  );
  return rows.map((row) => ({
    id: row.id,
    fileId: row.file_id,
    fileName: row.file_name,
    replyId: row.reply_id,
    internalReplyId: row.internal_reply_id,
  }));
}

export async function replaceTicketFiles(tx: Tx, organizationId: string, ticketId: string, files: Array<{ fileId: string; fileName: string }>, userId: string, now: number): Promise<string[]> {
  const oldRows = await tx.query<RowDataPacket>(
    'SELECT file_id FROM ticket_file WHERE ticket_id = ? AND reply_id IS NULL AND internal_reply_id IS NULL',
    [ticketId],
  );
  const nextIds = new Set(files.map((file) => file.fileId));
  const removed = oldRows.map((row) => String(row.file_id)).filter((id) => !nextIds.has(id));
  await tx.execute('DELETE FROM ticket_file WHERE ticket_id = ? AND reply_id IS NULL AND internal_reply_id IS NULL', [ticketId]);
  for (const file of files) {
    await tx.execute(
      `INSERT INTO ticket_file
        (id, organization_id, ticket_id, reply_id, internal_reply_id, file_id, file_name, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
      [nextId(), organizationId, ticketId, file.fileId, file.fileName, now, now, userId, userId],
    );
  }
  return removed;
}

export async function addReplyFiles(tx: Tx, organizationId: string, ticketId: string, replyId: string | null, internalReplyId: string | null, files: Array<{ fileId: string; fileName: string }>, userId: string, now: number): Promise<void> {
  for (const file of files) {
    await tx.execute(
      `INSERT INTO ticket_file
        (id, organization_id, ticket_id, reply_id, internal_reply_id, file_id, file_name, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nextId(), organizationId, ticketId, replyId, internalReplyId, file.fileId, file.fileName, now, now, userId, userId],
    );
  }
}

export async function findSatisfy(ticketId: string): Promise<{ score: number; advice: string; userId: string; createTime: number } | null> {
  const rows = await query<RowDataPacket>(
    'SELECT * FROM ticket_satisfy WHERE ticket_id = ? LIMIT 1',
    [ticketId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { score: asNumber(row.score), advice: row.advice, userId: row.user_id, createTime: asNumber(row.create_time) };
}

export async function insertSatisfy(tx: Tx, input: { organizationId: string; ticketId: string; userId: string; score: number; advice: string; now: number }): Promise<void> {
  await tx.execute(
    `INSERT INTO ticket_satisfy
      (id, organization_id, ticket_id, user_id, score, advice, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nextId(), input.organizationId, input.ticketId, input.userId, input.score, input.advice, input.now, input.now, input.userId, input.userId],
  );
}

export async function listFileIds(tx: Tx, ticketId: string): Promise<string[]> {
  const rows = await tx.query<RowDataPacket & { file_id: string }>(
    'SELECT file_id FROM ticket_file WHERE ticket_id = ?',
    [ticketId],
  );
  return rows.map((row) => row.file_id);
}

export async function purgeTicket(tx: Tx, ticketId: string, organizationId: string): Promise<void> {
  await tx.execute('DELETE FROM ticket_field WHERE resource_id = ?', [ticketId]);
  await tx.execute('DELETE FROM ticket_field_blob WHERE resource_id = ?', [ticketId]);
  await tx.execute('DELETE FROM ticket_reply WHERE ticket_id = ?', [ticketId]);
  await tx.execute('DELETE FROM ticket_internal_reply WHERE ticket_id = ?', [ticketId]);
  await tx.execute('DELETE FROM ticket_cc WHERE ticket_id = ?', [ticketId]);
  await tx.execute('DELETE FROM ticket_participant WHERE ticket_id = ?', [ticketId]);
  await tx.execute('DELETE FROM ticket_follow WHERE ticket_id = ?', [ticketId]);
  await tx.execute('DELETE FROM ticket_event WHERE ticket_id = ?', [ticketId]);
  await tx.execute('DELETE FROM ticket_satisfy WHERE ticket_id = ?', [ticketId]);
  await tx.execute('DELETE FROM ticket_file WHERE ticket_id = ?', [ticketId]);
  await tx.execute("DELETE FROM sys_notification WHERE resource_id = ? AND resource_type = 'TICKET'", [ticketId]);
  await tx.execute('DELETE FROM ticket WHERE id = ? AND organization_id = ?', [ticketId, organizationId]);
}

export async function findEnabledMember(organizationId: string, userId: string, tx?: Tx): Promise<{ departmentId: string | null } | null> {
  const rows = await (tx ?? { query }).query<RowDataPacket & { department_id: string | null }>(
    'SELECT department_id FROM sys_organization_user WHERE organization_id = ? AND user_id = ? AND enable = 1 LIMIT 1',
    [organizationId, userId],
  );
  return rows[0] ? { departmentId: rows[0].department_id } : null;
}

export async function enabledDepartmentUsers(tx: Tx, organizationId: string, departmentId: string): Promise<string[]> {
  const rows = await tx.query<RowDataPacket & { user_id: string }>(
    `SELECT user_id FROM sys_organization_user
     WHERE organization_id = ? AND department_id = ? AND enable = 1
     ORDER BY user_id`,
    [organizationId, departmentId],
  );
  return rows.map((row) => row.user_id);
}

export async function departmentCommanders(departmentId: string): Promise<string[]> {
  const rows = await query<RowDataPacket & { user_id: string }>(
    'SELECT user_id FROM sys_department_commander WHERE department_id = ?',
    [departmentId],
  );
  return rows.map((row) => row.user_id);
}

export async function findCustomerForTicket(input: {
  organizationId: string;
  contractId: string | null;
  orderId: string | null;
  mobile: string | null;
  mail: string | null;
  name: string | null;
}): Promise<string | null> {
  if (input.contractId) {
    const fromContract = await customerOnRow('contract', input.contractId, input.organizationId);
    if (fromContract) {
      return fromContract;
    }
  }
  if (input.orderId) {
    const fromOrder = await customerOnRow('sales_order', input.orderId, input.organizationId);
    if (fromOrder) {
      return fromOrder;
    }
  }
  const phone = digits(input.mobile);
  if (phone) {
    const rows = await query<RowDataPacket & { customer_id: string }>(
      `SELECT customer_id FROM customer_contact
       WHERE organization_id = ? AND customer_id IS NOT NULL AND customer_id <> ''
         AND (
           phone = ?
           OR REPLACE(REPLACE(REPLACE(IFNULL(phone, ''), '-', ''), ' ', ''), '+86', '') = ?
         )
       ORDER BY update_time DESC LIMIT 1`,
      [input.organizationId, input.mobile, phone],
    );
    if (rows[0]?.customer_id) {
      return rows[0].customer_id;
    }
  }
  const mail = (input.mail ?? '').trim().toLowerCase();
  if (mail) {
    const rows = await query<RowDataPacket & { customer_id: string }>(
      `SELECT cc.customer_id
       FROM customer_contact cc
       INNER JOIN customer_contact_field f ON f.resource_id = cc.id
       INNER JOIN sys_module_field mf ON mf.id = f.field_id AND mf.internal_key = 'contactEmail'
       WHERE cc.organization_id = ? AND cc.customer_id IS NOT NULL AND cc.customer_id <> ''
         AND LOWER(f.field_value) = ?
       ORDER BY cc.update_time DESC LIMIT 1`,
      [input.organizationId, mail],
    );
    if (rows[0]?.customer_id) {
      return rows[0].customer_id;
    }
  }
  const name = (input.name ?? '').trim();
  if (!name) {
    return null;
  }
  const customers = await query<RowDataPacket & { id: string }>(
    'SELECT id FROM customer WHERE organization_id = ? AND name = ? LIMIT 2',
    [input.organizationId, name],
  );
  if (customers.length === 1) {
    return customers[0].id;
  }
  const contacts = await query<RowDataPacket & { customer_id: string }>(
    `SELECT customer_id FROM customer_contact
     WHERE organization_id = ? AND name = ? AND customer_id IS NOT NULL AND customer_id <> ''
     GROUP BY customer_id LIMIT 2`,
    [input.organizationId, name],
  );
  if (contacts.length === 1) {
    return contacts[0].customer_id;
  }
  return null;
}

function digits(value: string | null): string {
  const numbers = (value ?? '').replace(/\D/g, '');
  if (numbers.length >= 11) {
    return numbers.slice(-11);
  }
  return numbers;
}

async function customerOnRow(table: 'contract' | 'sales_order', id: string, organizationId: string): Promise<string | null> {
  const rows = await query<RowDataPacket & { customer_id: string | null }>(
    `SELECT customer_id FROM ${table} WHERE id = ? AND organization_id = ? LIMIT 1`,
    [id, organizationId],
  );
  return rows[0]?.customer_id || null;
}

export async function recordExists(table: 'customer' | 'contract' | 'sales_order', id: string, organizationId: string): Promise<boolean> {
  const rows = await query<RowDataPacket>(
    `SELECT id FROM ${table} WHERE id = ? AND organization_id = ? LIMIT 1`,
    [id, organizationId],
  );
  return Boolean(rows[0]);
}

export async function listEnabledUsers(organizationId: string): Promise<Array<{ id: string; name: string; departmentId: string | null }>> {
  const rows = await query<RowDataPacket>(
    `SELECT u.id, u.name, ou.department_id
     FROM sys_user u
     INNER JOIN sys_organization_user ou ON ou.user_id = u.id
     WHERE ou.organization_id = ? AND ou.enable = 1
     ORDER BY u.name`,
    [organizationId],
  );
  return rows.map((row) => ({ id: row.id, name: row.name ?? '', departmentId: row.department_id }));
}

export async function listCustomerOptions(organizationId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await query<RowDataPacket>(
    'SELECT id, name FROM customer WHERE organization_id = ? ORDER BY create_time DESC LIMIT 200',
    [organizationId],
  );
  return rows.map((row) => ({ id: row.id, name: row.name ?? '' }));
}

export async function listDepartmentsOfOrg(organizationId: string): Promise<Array<{ id: string; name: string; parentId: string }>> {
  const rows = await query<RowDataPacket>(
    'SELECT id, name, parent_id FROM sys_department WHERE organization_id = ? ORDER BY pos',
    [organizationId],
  );
  return rows.map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id }));
}

export async function roleDepartments(roleIds: string[]): Promise<string[]> {
  if (roleIds.length === 0) {
    return [];
  }
  const marks = roleIds.map(() => '?').join(',');
  const rows = await query<RowDataPacket & { department_id: string }>(
    `SELECT department_id FROM sys_role_scope_dept WHERE role_id IN (${marks})`,
    roleIds,
  );
  return rows.map((row) => row.department_id);
}
