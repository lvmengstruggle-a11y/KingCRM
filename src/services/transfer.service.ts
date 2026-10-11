import type { RowDataPacket } from 'mysql2';

import { saveTempFiles, readTempFile } from './file.service.js';
import { insertRecord, pageRecords, tableColumns, updateRecord } from '../models/record.model.js';
import { execute, query } from '../support/db.js';
import { notFound, validateFailed } from '../support/errors.js';
import { ident } from '../support/ident.js';
import { nextId } from '../support/id.js';
import { entityByPrefix, type EntitySpec } from './crm-catalog.js';
import { addEntity, asIds, asObject, pageEntity, removeEntities, updateEntity } from './record.service.js';
import { approvalService } from './approval.service.js';
import { employeeService } from './employee.service.js';

export async function mergeCustomers(organizationId: string, userId: string, body: unknown): Promise<void> {
  const request = asObject(body);
  const targetId = String(request.toMergeId ?? '');
  const mergeIds = asIds({ mergeIds: request.mergeIds }).filter((id) => id && id !== targetId);
  if (!targetId || mergeIds.length === 0) {
    throw validateFailed('没有可合并的客户');
  }
  const target = await query<RowDataPacket>('SELECT id, owner FROM customer WHERE id = ? AND organization_id = ? LIMIT 1', [targetId, organizationId]);
  if (!target[0]) throw notFound('客户不存在');
  const marks = mergeIds.map(() => '?').join(', ');
  await retarget('customer_contact', organizationId, targetId, mergeIds);
  await retarget('opportunity', organizationId, targetId, mergeIds);
  await retarget('follow_up_record', organizationId, targetId, mergeIds);
  await retarget('follow_up_plan', organizationId, targetId, mergeIds);
  await retarget('contract', organizationId, targetId, mergeIds);
  await retarget('sales_order', organizationId, targetId, mergeIds);
  const collaborators = await query<RowDataPacket & { user_id: string; collaboration_type: string }>(
    `SELECT user_id, collaboration_type FROM customer_collaboration WHERE customer_id IN (${marks})`,
    mergeIds,
  );
  const owners = await query<RowDataPacket & { owner: string }>(
    `SELECT owner FROM customer WHERE organization_id = ? AND id IN (${marks})`,
    [organizationId, ...mergeIds],
  );
  const existing = new Set((await query<RowDataPacket & { user_id: string }>(
    'SELECT user_id FROM customer_collaboration WHERE customer_id = ?',
    [targetId],
  )).map((row) => row.user_id));
  const ownerId = String(request.ownerId || target[0].owner || '');
  const now = Date.now();
  for (const user of [...collaborators.map((row) => row.user_id), ...owners.map((row) => row.owner)]) {
    if (!user || user === ownerId || existing.has(user)) continue;
    existing.add(user);
    const type = collaborators.find((row) => row.user_id === user)?.collaboration_type ?? 'COLLABORATION';
    await execute(
      `INSERT INTO customer_collaboration
       (id, create_time, update_time, create_user, update_user, user_id, customer_id, collaboration_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nextId(), now, now, userId, userId, user, targetId, type],
    );
  }
  await removeEntities(entityByPrefix('/account'), organizationId, userId, mergeIds);
  if (ownerId && ownerId !== String(target[0].owner ?? '')) {
    await updateEntity(entityByPrefix('/account'), organizationId, userId, { id: targetId, owner: ownerId });
  }
}

export async function transitionLead(organizationId: string, userId: string, body: unknown): Promise<Record<string, unknown>> {
  const request = asObject(body);
  const clueId = String(request.clueId ?? '');
  const customer = await addEntity(entityByPrefix('/account'), organizationId, userId, { ...request, id: undefined });
  if (clueId) {
    await updateRecord('clue', clueId, organizationId, {
      transitionId: customer.id,
      transitionType: 'CUSTOMER',
      inSharedPool: false,
      updateTime: Date.now(),
      updateUser: userId,
    });
  }
  return customer;
}

export async function retransitionLeads(organizationId: string, userId: string, body: unknown): Promise<void> {
  const request = asObject(body);
  const customerId = String(request.customerId ?? '');
  const clueIds = Array.isArray(request.clueIds) ? request.clueIds.map((item) => String(item)) : [];
  if (!customerId || clueIds.length === 0) {
    throw validateFailed('请选择线索和客户');
  }
  for (const clueId of clueIds) {
    await updateRecord('clue', clueId, organizationId, {
      transitionId: customerId,
      transitionType: 'CUSTOMER',
      inSharedPool: false,
      updateTime: Date.now(),
      updateUser: userId,
    });
  }
}

export async function setQuotationState(organizationId: string, userId: string, id: string, state: 'void' | 'revoke' | 'approve', body?: unknown): Promise<void> {
  const rows = await query<RowDataPacket>('SELECT id FROM opportunity_quotation WHERE id = ? AND organization_id = ? LIMIT 1', [id, organizationId]);
  if (!rows[0]) throw notFound('报价单不存在');
  if (state === 'void') {
    const current = await query<RowDataPacket & { approval_status: string | null }>(
      'SELECT approval_status FROM opportunity_quotation WHERE id = ? AND organization_id = ? LIMIT 1',
      [id, organizationId],
    );
    await approvalService.guardAction('quotation', organizationId, String(current[0]?.approval_status ?? ''), 'VOIDED');
    await updateRecord('opportunity_quotation', id, organizationId, { invalid: true, approvalStatus: 'VOIDED', updateTime: Date.now(), updateUser: userId });
    return;
  }
  if (state === 'revoke') {
    await updateRecord('opportunity_quotation', id, organizationId, { invalid: false, approvalStatus: 'REVOKED', updateTime: Date.now(), updateUser: userId });
    return;
  }
  const status = String(asObject(body).approvalStatus || 'APPROVING');
  let finalStatus = status;
  if (status === 'APPROVING' || status === 'APPROVED') {
    try {
      await approvalService.push(id, 'quotation', organizationId, userId);
    } catch {
      finalStatus = 'APPROVED';
    }
  }
  await updateRecord('opportunity_quotation', id, organizationId, {
    approvalStatus: finalStatus,
    approved: finalStatus === 'APPROVED',
    updateTime: Date.now(),
    updateUser: userId,
  });
}

export async function batchQuotation(organizationId: string, userId: string, body: unknown, state: 'approve' | 'void'): Promise<{ success: number; fail: number }> {
  const ids = asIds(body);
  let success = 0;
  let fail = 0;
  for (const id of ids) {
    try {
      await setQuotationState(organizationId, userId, id, state === 'void' ? 'void' : 'approve', body);
      success += 1;
    } catch {
      fail += 1;
    }
  }
  return { success, fail };
}

export async function revokeApproval(table: string, organizationId: string, userId: string, id: string): Promise<void> {
  const columns = await tableColumns(table);
  if (!columns.some((column) => column.field === 'approvalStatus')) {
    return;
  }
  await updateRecord(table, id, organizationId, { approvalStatus: 'REVOKED', updateTime: Date.now(), updateUser: userId });
}

export async function exportRecords(spec: EntitySpec, organizationId: string, userId: string, body: unknown, resourceType: string, selected: boolean): Promise<{ id: string }> {
  const request = asObject(body);
  const ids = selected ? asIds(request) : undefined;
  const page = await pageRecords(spec.table, {
    organizationId,
    current: 1,
    pageSize: 5000,
    keyword: typeof request.keyword === 'string' ? request.keyword : undefined,
    keywordColumns: spec.keywordColumns,
    equals: {},
    inField: 'id',
    inValues: ids,
    inPool: spec.inPool,
    poolColumn: spec.poolColumn,
  });
  const heads = Array.isArray(request.headList) ? request.headList as Array<{ key?: string; title?: string }> : [{ key: 'name', title: '名称' }];
  const lines = [heads.map((head) => csvCell(head.title || head.key || '')).join(',')];
  for (const row of page.list) {
    lines.push(heads.map((head) => csvCell(row[String(head.key ?? '')])).join(','));
  }
  const fileName = String(request.fileName || resourceType).replace(/[\\/]/g, '') || resourceType;
  const storedName = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  const [fileId] = await saveTempFiles([{ filename: storedName, data: Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8') }]);
  const id = nextId();
  const now = Date.now();
  await execute(
    `INSERT INTO export_task
     (id, file_name, resource_type, file_id, status, organization_id, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, 'SUCCESS', ?, ?, ?, ?, ?)`,
    [id, storedName, resourceType, fileId ?? '', organizationId, now, now, userId, userId],
  );
  return { id };
}

export async function listExportTasks(organizationId: string, userId: string, body: unknown): Promise<Record<string, unknown>[]> {
  const request = asObject(body);
  const where = ['organization_id = ?', 'create_user = ?'];
  const params: unknown[] = [organizationId, userId];
  const keyword = String(request.keyword ?? '').trim();
  const resourceType = String(request.exportType ?? '').trim();
  const status = String(request.exportStatus ?? '').trim();
  if (keyword) {
    where.push('file_name LIKE ?');
    params.push(`%${keyword}%`);
  }
  if (resourceType) {
    where.push('resource_type = ?');
    params.push(resourceType);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const rows = await query<RowDataPacket>(
    `SELECT * FROM export_task WHERE ${where.join(' AND ')} ORDER BY create_time DESC LIMIT 200`,
    params,
  );
  return rows.map((row) => ({
    id: String(row.id),
    fileName: String(row.file_name),
    resourceType: String(row.resource_type),
    fileId: String(row.file_id),
    status: String(row.status),
    organizationId: String(row.organization_id),
    createUser: String(row.create_user),
    updateUser: String(row.update_user),
    createTime: Number(row.create_time),
    updateTime: Number(row.update_time),
  }));
}

export async function exportFile(taskId: string, organizationId: string): Promise<{ data: Buffer; filename: string }> {
  const rows = await query<RowDataPacket & { file_id: string; file_name: string }>(
    'SELECT file_id, file_name FROM export_task WHERE id = ? AND organization_id = ? LIMIT 1',
    [taskId, organizationId],
  );
  if (!rows[0]) throw notFound('导出任务不存在');
  const file = await readTempFile(String(rows[0].file_id));
  return { data: file.data, filename: String(rows[0].file_name || file.filename) };
}

export async function cancelExport(taskId: string, organizationId: string, userId: string): Promise<void> {
  await execute(
    'UPDATE export_task SET status = ?, update_time = ?, update_user = ? WHERE id = ? AND organization_id = ?',
    ['STOP', Date.now(), userId, taskId, organizationId],
  );
}

export function templateCsv(headers: string[]): Buffer {
  return Buffer.from(`\uFEFF${headers.join(',')}\n`, 'utf8');
}

export interface SheetCheck {
  failCount: number;
  successCount: number;
  errorMessages: Array<{ rowNum: number; errMsg: string }>;
  rows: Array<Record<string, string>>;
}

export function readSheet(file: Buffer): SheetCheck {
  if (file.subarray(0, 2).toString() === 'PK') {
    return { failCount: 1, successCount: 0, errorMessages: [{ rowNum: 1, errMsg: '请下载 CSV 模板后再导入' }], rows: [] };
  }
  const text = file.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length <= 1) {
    return { failCount: 0, successCount: 0, errorMessages: [], rows: [] };
  }
  const headers = splitCsv(lines[0] ?? '');
  const rows: Array<Record<string, string>> = [];
  const errorMessages: Array<{ rowNum: number; errMsg: string }> = [];
  for (let index = 1; index < lines.length; index += 1) {
    const cells = splitCsv(lines[index] ?? '');
    const row: Record<string, string> = {};
    headers.forEach((header, cellIndex) => {
      row[header] = cells[cellIndex] ?? '';
    });
    const name = row['名称'] || row['姓名'] || row['name'] || '';
    if (!name.trim()) {
      errorMessages.push({ rowNum: index + 1, errMsg: '名称不能为空' });
      continue;
    }
    rows.push(row);
  }
  return { failCount: errorMessages.length, successCount: rows.length, errorMessages, rows };
}

export async function importRows(spec: EntitySpec, organizationId: string, userId: string, rows: Array<Record<string, string>>): Promise<void> {
  for (const row of rows) {
    await addEntity(spec, organizationId, userId, {
      name: row['名称'] || row['name'],
      owner: userId,
      phone: row['手机号'] || row['电话'] || row['phone'] || undefined,
      contact: row['联系人'] || undefined,
    });
  }
}

export async function importUsers(organizationId: string, userId: string, rows: Array<Record<string, string>>): Promise<SheetCheck> {
  const errorMessages: Array<{ rowNum: number; errMsg: string }> = [];
  let successCount = 0;
  const departments = await query<RowDataPacket & { id: string; name: string }>(
    'SELECT id, name FROM sys_department WHERE organization_id = ?',
    [organizationId],
  );
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? {};
    const phone = row['手机号'] || row['phone'] || '';
    const department = departments.find((item) => item.name === (row['部门'] || ''));
    if (!phone) {
      errorMessages.push({ rowNum: index + 2, errMsg: '手机号不能为空' });
      continue;
    }
    if (!department) {
      errorMessages.push({ rowNum: index + 2, errMsg: '部门不存在' });
      continue;
    }
    try {
      await employeeService.add({
        name: row['姓名'] || row['名称'] || '',
        phone,
        email: row['邮箱'] || row['email'] || '',
        gender: false,
        departmentId: department.id,
        roleIds: [],
        enable: true,
      }, organizationId, userId);
      successCount += 1;
    } catch (error) {
      errorMessages.push({ rowNum: index + 2, errMsg: error instanceof Error ? error.message : '导入失败' });
    }
  }
  return { failCount: errorMessages.length, successCount, errorMessages, rows: [] };
}

export async function personalPlans(organizationId: string, userId: string, body: unknown) {
  return pageEntity(entityByPrefix('/follow/plan'), organizationId, userId, { ...asObject(body), owner: userId });
}

async function retarget(table: string, organizationId: string, targetId: string, ids: string[]): Promise<void> {
  const columns = await tableColumns(table);
  if (!columns.some((column) => column.field === 'customerId') || ids.length === 0) return;
  const hasUpdateTime = columns.some((column) => column.field === 'updateTime');
  await execute(
    `UPDATE ${ident(table)} SET customer_id = ?${hasUpdateTime ? ', update_time = ?' : ''}
     WHERE organization_id = ? AND customer_id IN (${ids.map(() => '?').join(', ')})`,
    hasUpdateTime ? [targetId, Date.now(), organizationId, ...ids] : [targetId, organizationId, ...ids],
  );
}

export async function importTitles(organizationId: string, userId: string, rows: Array<Record<string, string>>): Promise<void> {
  const now = Date.now();
  for (const row of rows) {
    await insertRecord('business_title', {
      id: nextId(),
      name: row['名称'] || row['name'] || '',
      organizationId,
      createTime: now,
      updateTime: now,
      createUser: userId,
      updateUser: userId,
    });
  }
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function splitCsv(line: string): string[] {
  return line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '').replaceAll('""', '"'));
}
