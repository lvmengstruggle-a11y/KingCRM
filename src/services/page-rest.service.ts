import type { RowDataPacket } from 'mysql2';

import { findOrganizationConfig, insertOrganizationConfig } from '../models/organization-config.model.js';
import { updateRecord } from '../models/record.model.js';
import { bitToBool } from '../support/bit.js';
import { execute, query } from '../support/db.js';
import { notFound, validateFailed } from '../support/errors.js';
import { ident } from '../support/ident.js';
import { nextId } from '../support/id.js';
import { normalizePage, toPager, type Pager } from '../support/pager.js';
import { approvalService } from './approval.service.js';
import { asObject } from './record.service.js';

const TITLE_FIELDS: Array<[string, string, boolean]> = [
  ['name', '公司名称', true],
  ['identificationNumber', '纳税人识别号', true],
  ['openingBank', '开户银行', false],
  ['bankAccount', '银行账号', false],
  ['registrationAddress', '注册地址', false],
  ['phoneNumber', '注册电话', false],
  ['registeredCapital', '注册资本', false],
  ['companySize', '公司规模', false],
  ['registrationNumber', '工商注册号', false],
];

const TITLE_LABELS = new Map(TITLE_FIELDS.map(([field, title]) => [field, title]));

export async function listTitleConfig(organizationId: string): Promise<Array<Record<string, unknown>>> {
  const existing = await query<RowDataPacket & { id: string; field: string; required: unknown }>(
    'SELECT id, field, required FROM business_title_config WHERE organization_id = ? ORDER BY field',
    [organizationId],
  );
  if (existing.length === 0) {
    for (const [field, , required] of TITLE_FIELDS) {
      await execute(
        'INSERT INTO business_title_config (id, field, required, organization_id) VALUES (?, ?, ?, ?)',
        [nextId(), field, required ? 1 : 0, organizationId],
      );
    }
    return listTitleConfig(organizationId);
  }
  return existing.map((row) => ({
    id: row.id,
    field: row.field,
    title: TITLE_LABELS.get(row.field) ?? row.field,
    required: bitToBool(row.required),
    organizationId,
  }));
}

export async function switchTitleConfig(organizationId: string, id: string): Promise<void> {
  const rows = await query<RowDataPacket & { required: unknown }>(
    'SELECT required FROM business_title_config WHERE id = ? AND organization_id = ? LIMIT 1',
    [id, organizationId],
  );
  if (!rows[0]) {
    throw notFound('抬头配置不存在');
  }
  await execute(
    'UPDATE business_title_config SET required = ? WHERE id = ? AND organization_id = ?',
    [bitToBool(rows[0].required) ? 0 : 1, id, organizationId],
  );
}

export async function queryLocalTitle(organizationId: string, keyword: string): Promise<Record<string, unknown>> {
  const rows = await query<RowDataPacket>(
    'SELECT * FROM business_title WHERE organization_id = ? AND name LIKE ? ORDER BY update_time DESC LIMIT 1',
    [organizationId, `%${keyword}%`],
  );
  const row = rows[0];
  if (!row) {
    return { name: keyword, type: 'THIRD_PARTY' };
  }
  return {
    name: row.name,
    identificationNumber: row.identification_number ?? '',
    openingBank: row.opening_bank ?? '',
    bankAccount: row.bank_account ?? '',
    registrationAddress: row.registration_address ?? '',
    phoneNumber: row.phone_number ?? '',
    registeredCapital: row.registered_capital ?? '',
    companySize: row.company_size ?? '',
    registrationNumber: row.registration_number ?? '',
    type: 'THIRD_PARTY',
  };
}

export async function titleOptions(organizationId: string, body: unknown): Promise<Pager<string[]>> {
  const request = asObject(body);
  const page = normalizePage(Number(request.current), Number(request.pageSize));
  const keyword = String(request.keyword ?? '');
  const where = ['organization_id = ?'];
  const params: unknown[] = [organizationId];
  if (keyword) {
    where.push('name LIKE ?');
    params.push(`%${keyword}%`);
  }
  const totalRows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM business_title WHERE ${where.join(' AND ')}`,
    params,
  );
  const rows = await query<RowDataPacket & { name: string }>(
    `SELECT name FROM business_title WHERE ${where.join(' AND ')} ORDER BY update_time DESC LIMIT ? OFFSET ?`,
    [...params, page.pageSize, (page.current - 1) * page.pageSize],
  );
  return toPager(rows.map((row) => [row.name]), Number(totalRows[0]?.total ?? 0), page);
}

export async function titleHasInvoice(organizationId: string, id: string): Promise<boolean> {
  const rows = await query<RowDataPacket & { total: number }>(
    'SELECT COUNT(*) AS total FROM contract_invoice WHERE organization_id = ? AND business_title_id = ?',
    [organizationId, id],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

export async function approveBusiness(table: string, formKey: string, organizationId: string, userId: string, body: unknown): Promise<void> {
  const request = asObject(body);
  const id = String(request.id ?? '');
  if (!id) {
    throw validateFailed('缺少审批数据');
  }
  const status = String(request.approvalStatus || 'APPROVING');
  let finalStatus = status;
  if (status === 'APPROVING' || status === 'APPROVED') {
    try {
      await approvalService.push(id, formKey, organizationId, userId);
    } catch {
      finalStatus = 'APPROVED';
    }
  }
  await updateRecord(table, id, organizationId, {
    approvalStatus: finalStatus,
    updateTime: Date.now(),
    updateUser: userId,
  });
}

export async function sortBoard(table: 'opportunity' | 'contract' | 'sales_order', organizationId: string, body: unknown): Promise<void> {
  const request = asObject(body);
  const dragId = String(request.dragNodeId ?? '');
  const dropId = String(request.dropNodeId ?? '');
  const rows = await query<RowDataPacket & { pos: number | string | null }>(
    `SELECT pos FROM ${ident(table)} WHERE id = ? AND organization_id = ? LIMIT 1`,
    [dropId, organizationId],
  );
  if (!dragId || !rows[0]) {
    throw notFound('看板数据不存在');
  }
  const pos = Number(rows[0].pos ?? 0) + (Number(request.dropPosition) < 0 ? -1 : 1);
  const values: Record<string, unknown> = { pos, updateTime: Date.now() };
  if (request.stage) {
    values.stage = request.stage;
  }
  await updateRecord(table, dragId, organizationId, values);
}

export async function updateLeadStage(organizationId: string, userId: string, body: unknown): Promise<void> {
  const request = asObject(body);
  const id = String(request.id ?? '');
  if (!id) {
    throw validateFailed('缺少线索');
  }
  await updateRecord('clue', id, organizationId, {
    stage: request.stage ?? request.status,
    updateTime: Date.now(),
    updateUser: userId,
  });
}

export async function listAuthSources(organizationId: string, userId: string, body: unknown): Promise<Pager<Record<string, unknown>>> {
  const request = asObject(body);
  const page = normalizePage(Number(request.current), Number(request.pageSize));
  const configId = String(request.configId || await ensureConfig(organizationId, userId, 'AUTH'));
  const keyword = String(request.keyword ?? '');
  const where = ['config_id = ?'];
  const params: unknown[] = [configId];
  if (keyword) {
    where.push('name LIKE ?');
    params.push(`%${keyword}%`);
  }
  const filter = where.join(' AND ');
  const totalRows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM sys_organization_config_detail WHERE ${filter}`,
    params,
  );
  const rows = await query<RowDataPacket>(
    `SELECT * FROM sys_organization_config_detail WHERE ${filter} ORDER BY create_time DESC LIMIT ? OFFSET ?`,
    [...params, page.pageSize, (page.current - 1) * page.pageSize],
  );
  return toPager(rows.map((row) => mapAuth(row, configId)), Number(totalRows[0]?.total ?? 0), page);
}

export async function getAuthSource(id: string): Promise<Record<string, unknown>> {
  const rows = await query<RowDataPacket>('SELECT * FROM sys_organization_config_detail WHERE id = ? LIMIT 1', [id]);
  if (!rows[0]) {
    throw notFound('认证源不存在');
  }
  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enable: bitToBool(row.enable),
    description: row.description ?? '',
    configuration: blobText(row.content),
  };
}

export async function saveAuthSource(organizationId: string, userId: string, body: unknown, id?: string): Promise<void> {
  const request = asObject(body);
  const name = String(request.name ?? '').trim();
  if (!name) {
    throw validateFailed('请填写认证源名称');
  }
  const configId = await ensureConfig(organizationId, userId, 'AUTH');
  const content = typeof request.configuration === 'string'
    ? request.configuration
    : JSON.stringify(request.configuration ?? {});
  const now = Date.now();
  if (id || request.id) {
    await execute(
      `UPDATE sys_organization_config_detail
       SET name = ?, type = ?, description = ?, content = ?, enable = ?, update_time = ?, update_user = ?
       WHERE id = ?`,
      [name, String(request.type || 'OAUTH2'), String(request.description ?? ''), Buffer.from(content), request.enable === false ? 0 : 1, now, userId, String(id || request.id)],
    );
    return;
  }
  await execute(
    `INSERT INTO sys_organization_config_detail
      (id, config_id, type, enable, name, content, description, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nextId(), configId, String(request.type || 'OAUTH2'), request.enable === false ? 0 : 1, name, Buffer.from(content), String(request.description ?? ''), now, now, userId, userId],
  );
}

export async function patchAuthSource(id: string, values: { enable?: boolean; name?: string }, userId: string): Promise<void> {
  if (values.name !== undefined) {
    await execute(
      'UPDATE sys_organization_config_detail SET name = ?, update_time = ?, update_user = ? WHERE id = ?',
      [values.name, Date.now(), userId, id],
    );
  }
  if (values.enable !== undefined) {
    await execute(
      'UPDATE sys_organization_config_detail SET enable = ?, update_time = ?, update_user = ? WHERE id = ?',
      [values.enable ? 1 : 0, Date.now(), userId, id],
    );
  }
}

export async function deleteAuthSource(id: string): Promise<void> {
  await execute('DELETE FROM sys_organization_config_detail WHERE id = ?', [id]);
}

export async function scheduleConfig(organizationId: string, type: string): Promise<Record<string, unknown>> {
  const stored = await readSync(organizationId, type);
  return stored ?? { enable: false, syncCycle: 'DAY', syncConfig: [], resourceType: type };
}

export async function saveSchedule(organizationId: string, userId: string, body: unknown): Promise<void> {
  const request = asObject(body);
  const type = String(request.resourceType || 'WECOM');
  const configId = await ensureConfig(organizationId, userId, 'SYNC');
  const content = JSON.stringify({
    enable: request.enable === true,
    syncCycle: request.syncCycle || 'DAY',
    syncConfig: request.syncScope ?? [],
    resourceType: type,
  });
  const existing = await query<RowDataPacket & { id: string }>(
    'SELECT id FROM sys_organization_config_detail WHERE config_id = ? AND type = ? LIMIT 1',
    [configId, type],
  );
  if (existing[0]) {
    await execute(
      'UPDATE sys_organization_config_detail SET content = ?, update_time = ?, update_user = ? WHERE id = ?',
      [Buffer.from(content), Date.now(), userId, existing[0].id],
    );
    return;
  }
  const now = Date.now();
  await execute(
    `INSERT INTO sys_organization_config_detail
      (id, config_id, type, enable, name, content, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    [nextId(), configId, type, type, Buffer.from(content), now, now, userId, userId],
  );
}

async function readSync(organizationId: string, type: string): Promise<Record<string, unknown> | null> {
  const config = await findOrganizationConfig(organizationId, 'SYNC');
  if (!config) {
    return null;
  }
  const rows = await query<RowDataPacket>(
    'SELECT content FROM sys_organization_config_detail WHERE config_id = ? AND type = ? LIMIT 1',
    [config.id, type],
  );
  if (!rows[0]) {
    return null;
  }
  try {
    return JSON.parse(blobText(rows[0].content)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function ensureConfig(organizationId: string, userId: string, type: string): Promise<string> {
  const config = await findOrganizationConfig(organizationId, type);
  if (config) {
    return config.id;
  }
  return insertOrganizationConfig({ organizationId, type, userId });
}

function mapAuth(row: RowDataPacket, configId: string): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enable: bitToBool(row.enable),
    description: row.description ?? '',
    createUser: row.create_user,
    updateUser: row.update_user,
    createTime: Number(row.create_time ?? 0),
    updateTime: Number(row.update_time ?? 0),
    configId,
    content: blobText(row.content),
  };
}

function blobText(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return typeof value === 'string' ? value : '';
}
