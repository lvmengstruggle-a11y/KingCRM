import type { RowDataPacket } from 'mysql2';

import { asNumber } from '../support/bit.js';
import { query, type Tx } from '../support/db.js';

export interface TicketTemplate {
  id: string;
  organizationId: string;
  name: string;
  enable: boolean;
  pos: number;
  enableCustomer: boolean;
  enableCc: boolean;
  enableHandler: boolean;
  enableDeadline: boolean;
  enableMobile: boolean;
  mobileRequired: boolean;
  enableMail: boolean;
  mailRequired: boolean;
}

export interface TicketStatus {
  id: string;
  organizationId: string;
  name: string;
  color: string;
  pos: number;
  isInitial: boolean;
  isTerminal: boolean;
  stopTiming: boolean;
}

export interface TicketRoute {
  id: string;
  organizationId: string;
  templateId: string;
  departmentId: string;
  lastHandlerId: string | null;
  templateName?: string;
  departmentName?: string;
}

export interface TicketConfig {
  id: string;
  organizationId: string;
  defaultDepartmentId: string | null;
  lastHandlerId: string | null;
  handlerCanClose: boolean;
  publisherCanClose: boolean;
  replyAfterClose: boolean;
  allowStatusBack: boolean;
  notifyAssign: boolean;
  notifyReplyPublisher: boolean;
  notifyReplyHandler: boolean;
  notifyReplyCc: boolean;
  notifyReplyFollow: boolean;
  notifyInternalHandler: boolean;
  notifyStatusPublisher: boolean;
  notifyClosePublisher: boolean;
  notifyRestartHandler: boolean;
  satisfyEnabled: boolean;
}

function flag(value: unknown): boolean {
  return Number(value) === 1;
}

function mapTemplate(row: RowDataPacket): TicketTemplate {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    enable: flag(row.enable),
    pos: asNumber(row.pos),
    enableCustomer: flag(row.enable_customer),
    enableCc: flag(row.enable_cc),
    enableHandler: flag(row.enable_handler),
    enableDeadline: flag(row.enable_deadline),
    enableMobile: flag(row.enable_mobile),
    mobileRequired: flag(row.mobile_required),
    enableMail: flag(row.enable_mail),
    mailRequired: flag(row.mail_required),
  };
}

function mapStatus(row: RowDataPacket): TicketStatus {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    color: row.color,
    pos: asNumber(row.pos),
    isInitial: flag(row.is_initial),
    isTerminal: flag(row.is_terminal),
    stopTiming: flag(row.stop_timing),
  };
}

function mapConfig(row: RowDataPacket): TicketConfig {
  return {
    id: row.id,
    organizationId: row.organization_id,
    defaultDepartmentId: row.default_department_id,
    lastHandlerId: row.last_handler_id,
    handlerCanClose: flag(row.handler_can_close),
    publisherCanClose: flag(row.publisher_can_close),
    replyAfterClose: flag(row.reply_after_close),
    allowStatusBack: flag(row.allow_status_back),
    notifyAssign: flag(row.notify_assign),
    notifyReplyPublisher: flag(row.notify_reply_publisher),
    notifyReplyHandler: flag(row.notify_reply_handler),
    notifyReplyCc: flag(row.notify_reply_cc),
    notifyReplyFollow: flag(row.notify_reply_follow),
    notifyInternalHandler: flag(row.notify_internal_handler),
    notifyStatusPublisher: flag(row.notify_status_publisher),
    notifyClosePublisher: flag(row.notify_close_publisher),
    notifyRestartHandler: flag(row.notify_restart_handler),
    satisfyEnabled: flag(row.satisfy_enabled),
  };
}

export async function listTemplates(organizationId: string): Promise<TicketTemplate[]> {
  const rows = await query<RowDataPacket>(
    'SELECT * FROM ticket_template WHERE organization_id = ? ORDER BY pos, create_time',
    [organizationId],
  );
  return rows.map(mapTemplate);
}

export async function findTemplate(id: string, organizationId: string, tx?: Tx): Promise<TicketTemplate | null> {
  const rows = await (tx ?? { query }).query<RowDataPacket>(
    'SELECT * FROM ticket_template WHERE id = ? AND organization_id = ? LIMIT 1',
    [id, organizationId],
  );
  return rows[0] ? mapTemplate(rows[0]) : null;
}

export async function insertTemplate(tx: Tx, row: TicketTemplate, userId: string, now: number): Promise<void> {
  await tx.execute(
    `INSERT INTO ticket_template
      (id, organization_id, name, enable, pos, enable_customer, enable_cc, enable_handler, enable_deadline,
       enable_mobile, mobile_required, enable_mail, mail_required, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.organizationId, row.name, row.enable ? 1 : 0, row.pos,
      row.enableCustomer ? 1 : 0, row.enableCc ? 1 : 0, row.enableHandler ? 1 : 0, row.enableDeadline ? 1 : 0,
      row.enableMobile ? 1 : 0, row.mobileRequired ? 1 : 0, row.enableMail ? 1 : 0, row.mailRequired ? 1 : 0,
      now, now, userId, userId,
    ],
  );
}

export async function updateTemplate(tx: Tx, row: TicketTemplate, userId: string, now: number): Promise<void> {
  await tx.execute(
    `UPDATE ticket_template SET name = ?, enable = ?, pos = ?, enable_customer = ?, enable_cc = ?, enable_handler = ?,
      enable_deadline = ?, enable_mobile = ?, mobile_required = ?, enable_mail = ?, mail_required = ?,
      update_time = ?, update_user = ? WHERE id = ? AND organization_id = ?`,
    [
      row.name, row.enable ? 1 : 0, row.pos, row.enableCustomer ? 1 : 0, row.enableCc ? 1 : 0, row.enableHandler ? 1 : 0,
      row.enableDeadline ? 1 : 0, row.enableMobile ? 1 : 0, row.mobileRequired ? 1 : 0, row.enableMail ? 1 : 0, row.mailRequired ? 1 : 0,
      now, userId, row.id, row.organizationId,
    ],
  );
}

export async function deleteTemplate(tx: Tx, id: string, organizationId: string): Promise<void> {
  await tx.execute('DELETE FROM ticket_template WHERE id = ? AND organization_id = ?', [id, organizationId]);
}

export async function countTicketsByTemplate(templateId: string, organizationId: string): Promise<number> {
  const rows = await query<RowDataPacket & { total: number }>(
    'SELECT COUNT(*) AS total FROM ticket WHERE template_id = ? AND organization_id = ?',
    [templateId, organizationId],
  );
  return asNumber(rows[0]?.total);
}

export async function listStatuses(organizationId: string, tx?: Tx): Promise<TicketStatus[]> {
  const rows = await (tx ?? { query }).query<RowDataPacket>(
    'SELECT * FROM ticket_status WHERE organization_id = ? ORDER BY pos',
    [organizationId],
  );
  return rows.map(mapStatus);
}

export async function findStatus(id: string, organizationId: string): Promise<TicketStatus | null> {
  const rows = await query<RowDataPacket>(
    'SELECT * FROM ticket_status WHERE id = ? AND organization_id = ? LIMIT 1',
    [id, organizationId],
  );
  return rows[0] ? mapStatus(rows[0]) : null;
}

export async function insertStatus(tx: Tx, row: TicketStatus, userId: string, now: number): Promise<void> {
  await tx.execute(
    `INSERT INTO ticket_status
      (id, organization_id, name, color, pos, is_initial, is_terminal, stop_timing, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.organizationId, row.name, row.color, row.pos, row.isInitial ? 1 : 0, row.isTerminal ? 1 : 0,
      row.stopTiming ? 1 : 0, now, now, userId, userId,
    ],
  );
}

export async function updateStatus(tx: Tx, row: TicketStatus, userId: string, now: number): Promise<void> {
  await tx.execute(
    `UPDATE ticket_status SET name = ?, color = ?, pos = ?, is_initial = ?, is_terminal = ?, stop_timing = ?,
      update_time = ?, update_user = ? WHERE id = ? AND organization_id = ?`,
    [
      row.name, row.color, row.pos, row.isInitial ? 1 : 0, row.isTerminal ? 1 : 0, row.stopTiming ? 1 : 0,
      now, userId, row.id, row.organizationId,
    ],
  );
}

export async function clearStatusFlag(tx: Tx, organizationId: string, column: 'is_initial' | 'is_terminal', exceptId: string): Promise<void> {
  await tx.execute(
    `UPDATE ticket_status SET ${column} = 0 WHERE organization_id = ? AND id <> ?`,
    [organizationId, exceptId],
  );
}

export async function deleteStatus(tx: Tx, id: string, organizationId: string): Promise<void> {
  await tx.execute('DELETE FROM ticket_status WHERE id = ? AND organization_id = ?', [id, organizationId]);
}

export async function countTicketsByStatus(statusId: string, organizationId: string): Promise<number> {
  const rows = await query<RowDataPacket & { total: number }>(
    'SELECT COUNT(*) AS total FROM ticket WHERE status_id = ? AND organization_id = ?',
    [statusId, organizationId],
  );
  return asNumber(rows[0]?.total);
}

export async function listRoutes(organizationId: string): Promise<TicketRoute[]> {
  const rows = await query<RowDataPacket>(
    `SELECT r.*, t.name AS template_name, d.name AS department_name
     FROM ticket_route r
     LEFT JOIN ticket_template t ON t.id = r.template_id
     LEFT JOIN sys_department d ON d.id = r.department_id
     WHERE r.organization_id = ?
     ORDER BY r.create_time`,
    [organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    templateId: row.template_id,
    departmentId: row.department_id,
    lastHandlerId: row.last_handler_id,
    templateName: row.template_name ?? '',
    departmentName: row.department_name ?? '',
  }));
}

export async function lockRoute(tx: Tx, organizationId: string, templateId: string): Promise<TicketRoute | null> {
  const rows = await tx.query<RowDataPacket>(
    `SELECT * FROM ticket_route WHERE organization_id = ? AND template_id = ? LIMIT 1 FOR UPDATE`,
    [organizationId, templateId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    templateId: row.template_id,
    departmentId: row.department_id,
    lastHandlerId: row.last_handler_id,
  };
}

export async function saveRoute(tx: Tx, row: TicketRoute, userId: string, now: number): Promise<void> {
  const existing = await tx.query<RowDataPacket>(
    'SELECT id FROM ticket_route WHERE organization_id = ? AND template_id = ? LIMIT 1',
    [row.organizationId, row.templateId],
  );
  if (existing[0]) {
    await tx.execute(
      `UPDATE ticket_route SET department_id = ?, update_time = ?, update_user = ? WHERE id = ?`,
      [row.departmentId, now, userId, existing[0].id],
    );
    return;
  }
  await tx.execute(
    `INSERT INTO ticket_route
      (id, organization_id, template_id, department_id, last_handler_id, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    [row.id, row.organizationId, row.templateId, row.departmentId, now, now, userId, userId],
  );
}

export async function updateRouteCursor(tx: Tx, id: string, handlerId: string, userId: string, now: number): Promise<void> {
  await tx.execute(
    'UPDATE ticket_route SET last_handler_id = ?, update_time = ?, update_user = ? WHERE id = ?',
    [handlerId, now, userId, id],
  );
}

export async function deleteRoute(tx: Tx, id: string, organizationId: string): Promise<void> {
  await tx.execute('DELETE FROM ticket_route WHERE id = ? AND organization_id = ?', [id, organizationId]);
}

export async function findConfig(organizationId: string, tx?: Tx): Promise<TicketConfig | null> {
  const rows = await (tx ?? { query }).query<RowDataPacket>(
    'SELECT * FROM ticket_config WHERE organization_id = ? LIMIT 1',
    [organizationId],
  );
  return rows[0] ? mapConfig(rows[0]) : null;
}

export async function lockConfig(tx: Tx, organizationId: string): Promise<TicketConfig | null> {
  const rows = await tx.query<RowDataPacket>(
    'SELECT * FROM ticket_config WHERE organization_id = ? LIMIT 1 FOR UPDATE',
    [organizationId],
  );
  return rows[0] ? mapConfig(rows[0]) : null;
}

export async function insertConfig(tx: Tx, row: TicketConfig, userId: string, now: number): Promise<void> {
  await tx.execute(
    `INSERT INTO ticket_config
      (id, organization_id, default_department_id, last_handler_id, handler_can_close, publisher_can_close,
       reply_after_close, allow_status_back, notify_assign, notify_reply_publisher, notify_reply_handler,
       notify_reply_cc, notify_reply_follow, notify_internal_handler, notify_status_publisher, notify_close_publisher,
       notify_restart_handler, satisfy_enabled, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.organizationId, row.defaultDepartmentId, row.lastHandlerId,
      row.handlerCanClose ? 1 : 0, row.publisherCanClose ? 1 : 0, row.replyAfterClose ? 1 : 0, row.allowStatusBack ? 1 : 0,
      row.notifyAssign ? 1 : 0, row.notifyReplyPublisher ? 1 : 0, row.notifyReplyHandler ? 1 : 0, row.notifyReplyCc ? 1 : 0,
      row.notifyReplyFollow ? 1 : 0, row.notifyInternalHandler ? 1 : 0, row.notifyStatusPublisher ? 1 : 0,
      row.notifyClosePublisher ? 1 : 0, row.notifyRestartHandler ? 1 : 0, row.satisfyEnabled ? 1 : 0,
      now, now, userId, userId,
    ],
  );
}

export async function updateConfig(tx: Tx, row: TicketConfig, userId: string, now: number): Promise<void> {
  await tx.execute(
    `UPDATE ticket_config SET default_department_id = ?, handler_can_close = ?, publisher_can_close = ?,
      reply_after_close = ?, allow_status_back = ?, notify_assign = ?, notify_reply_publisher = ?, notify_reply_handler = ?,
      notify_reply_cc = ?, notify_reply_follow = ?, notify_internal_handler = ?, notify_status_publisher = ?,
      notify_close_publisher = ?, notify_restart_handler = ?, satisfy_enabled = ?, update_time = ?, update_user = ?
     WHERE id = ? AND organization_id = ?`,
    [
      row.defaultDepartmentId, row.handlerCanClose ? 1 : 0, row.publisherCanClose ? 1 : 0, row.replyAfterClose ? 1 : 0,
      row.allowStatusBack ? 1 : 0, row.notifyAssign ? 1 : 0, row.notifyReplyPublisher ? 1 : 0, row.notifyReplyHandler ? 1 : 0,
      row.notifyReplyCc ? 1 : 0, row.notifyReplyFollow ? 1 : 0, row.notifyInternalHandler ? 1 : 0, row.notifyStatusPublisher ? 1 : 0,
      row.notifyClosePublisher ? 1 : 0, row.notifyRestartHandler ? 1 : 0, row.satisfyEnabled ? 1 : 0,
      now, userId, row.id, row.organizationId,
    ],
  );
}

export async function updateConfigCursor(tx: Tx, id: string, handlerId: string, userId: string, now: number): Promise<void> {
  await tx.execute(
    'UPDATE ticket_config SET last_handler_id = ?, update_time = ?, update_user = ? WHERE id = ?',
    [handlerId, now, userId, id],
  );
}

export async function countDepartmentTicketUsage(ids: string[], organizationId: string): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const marks = ids.map(() => '?').join(',');
  const rows = await query<RowDataPacket & { total: number }>(
    `SELECT
       (SELECT COUNT(*) FROM ticket WHERE organization_id = ? AND department_id IN (${marks}))
       + (SELECT COUNT(*) FROM ticket_route WHERE organization_id = ? AND department_id IN (${marks})) AS total`,
    [organizationId, ...ids, organizationId, ...ids],
  );
  return asNumber(rows[0]?.total);
}

export async function firstDepartmentId(organizationId: string): Promise<string | null> {
  const rows = await query<RowDataPacket & { id: string }>(
    'SELECT id FROM sys_department WHERE organization_id = ? ORDER BY pos LIMIT 1',
    [organizationId],
  );
  return rows[0]?.id ?? null;
}
