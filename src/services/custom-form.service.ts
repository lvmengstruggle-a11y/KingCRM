import type { RowDataPacket } from 'mysql2';

import { getFormConfig, saveFormConfig, type FormField } from '../models/form.model.js';
import { deleteModuleFields, loadModuleFields, replaceModuleFields, type ModuleFieldValue } from '../models/record.model.js';
import { ADMIN_USER_ID } from '../config/index.js';
import { bitToBool } from '../support/bit.js';
import { execute, query } from '../support/db.js';
import { notFound, validateFailed } from '../support/errors.js';
import { nextId } from '../support/id.js';
import { translate } from '../support/i18n.js';
import { normalizePage, toPager } from '../support/pager.js';
import { asObject } from './record.service.js';

const ROLES = [
  ['MANAGE_ALL', 'custom.form.role.manage_all'],
  ['VIEW_ALL', 'custom.form.role.view_all'],
  ['MANAGE_OWN', 'custom.form.role.manage_own'],
] as const;

export async function addCustomForm(organizationId: string, userId: string, body: unknown): Promise<{ id: string }> {
  const request = asObject(body);
  const name = String(request.name ?? '').trim();
  if (!name) {
    throw validateFailed('表单名称不能为空');
  }
  await assertUniqueName(organizationId, name, '');
  const id = nextId();
  const now = Date.now();
  await execute(
    `INSERT INTO custom_form
     (id, name, enable, organization_id, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, request.enable === false ? 0 : 1, organizationId, now, now, userId, userId],
  );
  for (const [key, i18nKey] of ROLES) {
    await execute(
      `INSERT INTO custom_form_role
       (id, name, custom_form_id, internal_key, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nextId(), translate(i18nKey, key), id, key, now, now, userId, userId],
    );
  }
  await saveFormConfig({
    formKey: id,
    organizationId,
    userId,
    fields: Array.isArray(request.fields) ? request.fields as FormField[] : [],
    formProp: asObject(request.formProp),
  });
  return { id };
}

export async function updateCustomForm(organizationId: string, userId: string, body: unknown): Promise<void> {
  const request = asObject(body);
  const id = String(request.id ?? '');
  const current = await findForm(id, organizationId);
  const name = String(request.name ?? current.name).trim();
  await assertUniqueName(organizationId, name, id);
  await execute(
    'UPDATE custom_form SET name = ?, enable = ?, update_time = ?, update_user = ? WHERE id = ? AND organization_id = ?',
    [name, request.enable === false ? 0 : 1, Date.now(), userId, id, organizationId],
  );
  if (Array.isArray(request.fields) || request.formProp) {
    await saveFormConfig({
      formKey: id,
      organizationId,
      userId,
      fields: Array.isArray(request.fields) ? request.fields as FormField[] : undefined,
      formProp: request.formProp ? asObject(request.formProp) : undefined,
    });
  }
}

export async function getCustomForm(id: string, organizationId: string): Promise<Record<string, unknown>> {
  const form = await findForm(id, organizationId);
  const config = await getFormConfig(id, organizationId);
  const names = await userNameMap([String(form.create_user)]);
  return {
    id: form.id,
    name: form.name,
    enable: bitToBool(form.enable),
    fields: config.fields,
    formProp: config.formProp,
    creator: { id: String(form.create_user), name: names.get(String(form.create_user)) ?? '' },
  };
}

export async function listCustomForms(organizationId: string, userId: string, enabledOnly: boolean): Promise<Record<string, unknown>[]> {
  const rows = await query<RowDataPacket>(
    'SELECT * FROM custom_form WHERE organization_id = ? ORDER BY create_time DESC',
    [organizationId],
  );
  const adminIds = await adminFormIds(userId);
  const manageIds = await manageFormIds(userId);
  const isPlatformAdmin = userId === ADMIN_USER_ID;
  return rows.flatMap((row) => {
    const id = String(row.id);
    const isAdmin = isPlatformAdmin || adminIds.has(id);
    const enabled = bitToBool(row.enable);
    if (enabledOnly && !enabled) {
      return [];
    }
    if (!isPlatformAdmin && !isAdmin && !enabled && !manageIds.has(id)) {
      return [];
    }
    return [{
      id,
      name: String(row.name),
      enable: enabled,
      isAdmin,
      hasCreateDataPermission: isPlatformAdmin || isAdmin || manageIds.has(id),
    }];
  });
}

export async function setCustomFormEnable(id: string, organizationId: string, userId: string, enable: boolean): Promise<void> {
  await findForm(id, organizationId);
  await execute(
    'UPDATE custom_form SET enable = ?, update_time = ?, update_user = ? WHERE id = ?',
    [enable ? 1 : 0, Date.now(), userId, id],
  );
}

export async function deleteCustomForm(id: string, organizationId: string): Promise<void> {
  await findForm(id, organizationId);
  const data = await query<RowDataPacket & { id: string }>(
    'SELECT id FROM custom_form_data WHERE custom_form_id = ?',
    [id],
  );
  const dataIds = data.map((row) => row.id);
  await deleteModuleFields('custom_form_data_field', 'custom_form_data_field_blob', dataIds);
  if (dataIds.length > 0) {
    await execute(`DELETE FROM custom_form_data WHERE id IN (${dataIds.map(() => '?').join(', ')})`, dataIds);
  }
  const roles = await query<RowDataPacket & { id: string }>('SELECT id FROM custom_form_role WHERE custom_form_id = ?', [id]);
  const roleIds = roles.map((row) => row.id);
  if (roleIds.length > 0) {
    await execute(`DELETE FROM custom_form_role_user WHERE role_id IN (${roleIds.map(() => '?').join(', ')})`, roleIds);
  }
  await execute('DELETE FROM custom_form_role WHERE custom_form_id = ?', [id]);
  await execute('DELETE FROM custom_form_admin WHERE custom_form_id = ?', [id]);
  await execute('DELETE FROM custom_form WHERE id = ? AND organization_id = ?', [id, organizationId]);
  const forms = await query<RowDataPacket & { id: string }>(
    'SELECT id FROM sys_module_form WHERE form_key = ? AND organization_id = ?',
    [id, organizationId],
  );
  for (const form of forms) {
    await execute('DELETE FROM sys_module_field_blob WHERE id IN (SELECT id FROM sys_module_field WHERE form_id = ?)', [form.id]);
    await execute('DELETE FROM sys_module_field WHERE form_id = ?', [form.id]);
    await execute('DELETE FROM sys_module_form_blob WHERE id = ?', [form.id]);
    await execute('DELETE FROM sys_module_form WHERE id = ?', [form.id]);
  }
}

export async function getAdmins(customFormId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await query<RowDataPacket & { user_id: string; name: string | null }>(
    `SELECT a.user_id, u.name FROM custom_form_admin a
     LEFT JOIN sys_user u ON u.id = a.user_id WHERE a.custom_form_id = ?`,
    [customFormId],
  );
  return rows.map((row) => ({ id: row.user_id, name: row.name ?? '' }));
}

export async function setAdmins(body: unknown): Promise<void> {
  const request = asObject(body);
  const customFormId = String(request.customFormId ?? '');
  const userIds = Array.isArray(request.userIds) ? request.userIds.map((item) => String(item)).filter(Boolean) : [];
  await execute('DELETE FROM custom_form_admin WHERE custom_form_id = ?', [customFormId]);
  for (const userId of userIds) {
    await execute('INSERT INTO custom_form_admin (id, custom_form_id, user_id) VALUES (?, ?, ?)', [nextId(), customFormId, userId]);
  }
}

export async function listRoles(customFormId: string): Promise<Record<string, unknown>[]> {
  const rows = await query<RowDataPacket>('SELECT * FROM custom_form_role WHERE custom_form_id = ? ORDER BY create_time', [customFormId]);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    customFormId: String(row.custom_form_id),
    internalKey: String(row.internal_key),
  }));
}

export async function pageRoleUsers(organizationId: string, body: unknown) {
  const request = asObject(body);
  const roleId = String(request.customFormRoleId ?? '');
  const page = normalizePage(Number(request.current), Number(request.pageSize));
  const totals = await query<RowDataPacket & { total: number }>(
    'SELECT COUNT(*) AS total FROM custom_form_role_user WHERE role_id = ?',
    [roleId],
  );
  const rows = await query<RowDataPacket>(
    `SELECT ru.id, ru.user_id, ru.create_time, u.name AS username, ou.department_id, d.name AS department_name, ou.position
     FROM custom_form_role_user ru
     LEFT JOIN sys_user u ON u.id = ru.user_id
     LEFT JOIN sys_organization_user ou ON ou.user_id = ru.user_id AND ou.organization_id = ?
     LEFT JOIN sys_department d ON d.id = ou.department_id
     WHERE ru.role_id = ?
     ORDER BY ru.create_time DESC LIMIT ? OFFSET ?`,
    [organizationId, roleId, page.pageSize, (page.current - 1) * page.pageSize],
  );
  const role = (await query<RowDataPacket>('SELECT id, name FROM custom_form_role WHERE id = ? LIMIT 1', [roleId]))[0];
  const list = rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    username: String(row.username ?? ''),
    departmentId: String(row.department_id ?? ''),
    departmentName: String(row.department_name ?? ''),
    position: String(row.position ?? ''),
    createTime: Number(row.create_time ?? 0),
    roles: role ? [{ id: String(role.id), name: String(role.name) }] : [],
  }));
  return toPager(list, Number(totals[0]?.total ?? 0), page);
}

export async function relateMembers(organizationId: string, userId: string, body: unknown): Promise<void> {
  const request = asObject(body);
  const roleId = String(request.customFormRoleId ?? '');
  if (!roleId) {
    throw validateFailed('缺少角色');
  }
  const userIds = new Set<string>(Array.isArray(request.userIds) ? request.userIds.map((item) => String(item)) : []);
  const deptIds = Array.isArray(request.deptIds) ? request.deptIds.map((item) => String(item)).filter(Boolean) : [];
  const roleIds = Array.isArray(request.roleIds) ? request.roleIds.map((item) => String(item)).filter(Boolean) : [];
  if (deptIds.length > 0) {
    const rows = await query<RowDataPacket & { user_id: string }>(
      `SELECT user_id FROM sys_organization_user WHERE organization_id = ? AND department_id IN (${deptIds.map(() => '?').join(', ')})`,
      [organizationId, ...deptIds],
    );
    for (const row of rows) userIds.add(row.user_id);
  }
  if (roleIds.length > 0) {
    const rows = await query<RowDataPacket & { user_id: string }>(
      `SELECT user_id FROM sys_user_role WHERE role_id IN (${roleIds.map(() => '?').join(', ')})`,
      roleIds,
    );
    for (const row of rows) userIds.add(row.user_id);
  }
  const now = Date.now();
  for (const memberId of userIds) {
    const exists = await query<RowDataPacket>(
      'SELECT id FROM custom_form_role_user WHERE role_id = ? AND user_id = ? LIMIT 1',
      [roleId, memberId],
    );
    if (exists[0]) continue;
    await execute(
      `INSERT INTO custom_form_role_user (id, role_id, user_id, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nextId(), roleId, memberId, now, now, userId, userId],
    );
  }
}

export async function removeMembers(body: unknown): Promise<void> {
  const request = asObject(body);
  const roleId = String(request.customFormRoleId ?? '');
  const userIds = Array.isArray(request.userIds) ? request.userIds.map((item) => String(item)).filter(Boolean) : [];
  if (!roleId || userIds.length === 0) {
    return;
  }
  await execute(
    `DELETE FROM custom_form_role_user WHERE role_id = ? AND user_id IN (${userIds.map(() => '?').join(', ')})`,
    [roleId, ...userIds],
  );
}

export async function canCreate(customFormId: string, userId: string): Promise<boolean> {
  if (userId === ADMIN_USER_ID || (await adminFormIds(userId)).has(customFormId)) {
    return true;
  }
  return (await manageFormIds(userId)).has(customFormId);
}

export async function addFormData(organizationId: string, userId: string, body: unknown): Promise<{ id: string }> {
  const request = asObject(body);
  const customFormId = String(request.customFormId ?? '');
  const name = String(request.name ?? '').trim();
  if (!customFormId || !name) {
    throw validateFailed('名称不能为空');
  }
  const id = nextId();
  const now = Date.now();
  const owner = String(request.owner || userId);
  await execute(
    `INSERT INTO custom_form_data
     (id, custom_form_id, name, owner, organization_id, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, customFormId, name, owner, organizationId, now, now, userId, userId],
  );
  await replaceModuleFields(
    'custom_form_data_field',
    'custom_form_data_field_blob',
    id,
    fieldsOf(request),
    await fieldTypeMap(customFormId, organizationId),
  );
  return { id };
}

export async function updateFormData(organizationId: string, userId: string, body: unknown): Promise<void> {
  const request = asObject(body);
  const id = String(request.id ?? '');
  const current = await findData(id, organizationId);
  await execute(
    'UPDATE custom_form_data SET name = ?, owner = ?, update_time = ?, update_user = ? WHERE id = ?',
    [String(request.name ?? current.name), String(request.owner || current.owner), Date.now(), userId, id],
  );
  if (Array.isArray(request.moduleFields)) {
    await replaceModuleFields(
      'custom_form_data_field',
      'custom_form_data_field_blob',
      id,
      fieldsOf(request),
      await fieldTypeMap(String(current.custom_form_id), organizationId),
    );
  }
}

export async function getFormData(id: string, organizationId: string, userId: string): Promise<Record<string, unknown>> {
  const row = await findData(id, organizationId);
  const fields = await loadModuleFields('custom_form_data_field', 'custom_form_data_field_blob', [id]);
  const names = await userNameMap([String(row.owner), String(row.create_user), String(row.update_user)]);
  return {
    ...dataItem(row, fields.get(id) ?? [], names, userId),
    optionMap: { owner: [...names.entries()].map(([itemId, name]) => ({ id: itemId, name })) },
  };
}

export async function pageFormData(organizationId: string, userId: string, body: unknown) {
  const request = asObject(body);
  const customFormId = String(request.customFormId ?? '');
  const page = normalizePage(Number(request.current), Number(request.pageSize));
  const keyword = String(request.keyword ?? '').trim();
  const where = ['organization_id = ?', 'custom_form_id = ?'];
  const params: unknown[] = [organizationId, customFormId];
  if (keyword) {
    where.push('name LIKE ?');
    params.push(`%${keyword}%`);
  }
  const clause = where.join(' AND ');
  const totals = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM custom_form_data WHERE ${clause}`,
    params,
  );
  const rows = await query<RowDataPacket>(
    `SELECT * FROM custom_form_data WHERE ${clause} ORDER BY create_time DESC LIMIT ? OFFSET ?`,
    [...params, page.pageSize, (page.current - 1) * page.pageSize],
  );
  const ids = rows.map((row) => String(row.id));
  const fields = await loadModuleFields('custom_form_data_field', 'custom_form_data_field_blob', ids);
  const names = await userNameMap(rows.flatMap((row) => [String(row.owner), String(row.create_user), String(row.update_user)]));
  return {
    ...toPager(rows.map((row) => dataItem(row, fields.get(String(row.id)) ?? [], names, userId)), Number(totals[0]?.total ?? 0), page),
    optionMap: { owner: [...names.entries()].map(([id, name]) => ({ id, name })) },
  };
}

export async function deleteFormData(ids: string[], organizationId: string): Promise<void> {
  if (ids.length === 0) return;
  await deleteModuleFields('custom_form_data_field', 'custom_form_data_field_blob', ids);
  await execute(
    `DELETE FROM custom_form_data WHERE organization_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
    [organizationId, ...ids],
  );
}

export async function batchUpdateFormData(organizationId: string, userId: string, body: unknown): Promise<void> {
  const request = asObject(body);
  const ids = Array.isArray(request.ids) ? request.ids.map((item) => String(item)) : [];
  for (const id of ids) {
    await updateFormData(organizationId, userId, { ...request, id });
  }
}

async function findForm(id: string, organizationId: string): Promise<RowDataPacket> {
  const rows = await query<RowDataPacket>('SELECT * FROM custom_form WHERE id = ? AND organization_id = ? LIMIT 1', [id, organizationId]);
  if (!rows[0]) throw notFound('表单不存在');
  return rows[0];
}

async function findData(id: string, organizationId: string): Promise<RowDataPacket> {
  const rows = await query<RowDataPacket>('SELECT * FROM custom_form_data WHERE id = ? AND organization_id = ? LIMIT 1', [id, organizationId]);
  if (!rows[0]) throw notFound('数据不存在');
  return rows[0];
}

async function assertUniqueName(organizationId: string, name: string, id: string): Promise<void> {
  const rows = await query<RowDataPacket>(
    'SELECT id FROM custom_form WHERE organization_id = ? AND name = ? AND id <> ? LIMIT 1',
    [organizationId, name, id],
  );
  if (rows[0]) throw validateFailed('表单名称已存在');
}

async function adminFormIds(userId: string): Promise<Set<string>> {
  const rows = await query<RowDataPacket & { custom_form_id: string }>(
    'SELECT custom_form_id FROM custom_form_admin WHERE user_id = ?',
    [userId],
  );
  return new Set(rows.map((row) => row.custom_form_id));
}

async function manageFormIds(userId: string): Promise<Set<string>> {
  const rows = await query<RowDataPacket & { custom_form_id: string }>(
    `SELECT r.custom_form_id FROM custom_form_role_user ru
     JOIN custom_form_role r ON r.id = ru.role_id
     WHERE ru.user_id = ? AND r.internal_key IN ('MANAGE_ALL', 'MANAGE_OWN')`,
    [userId],
  );
  return new Set(rows.map((row) => row.custom_form_id));
}

async function userNameMap(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const rows = await query<RowDataPacket & { id: string; name: string }>(
    `SELECT id, name FROM sys_user WHERE id IN (${unique.map(() => '?').join(', ')})`,
    unique,
  );
  for (const row of rows) names.set(row.id, row.name);
  return names;
}

async function fieldTypeMap(formId: string, organizationId: string): Promise<Map<string, string>> {
  const config = await getFormConfig(formId, organizationId);
  return new Map(config.fields.map((field) => [field.id, String(field.type)]));
}

function fieldsOf(body: Record<string, unknown>): ModuleFieldValue[] {
  if (!Array.isArray(body.moduleFields)) return [];
  return body.moduleFields.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const field = item as Record<string, unknown>;
    return typeof field.fieldId === 'string' && field.fieldId ? [{ fieldId: field.fieldId, fieldValue: field.fieldValue }] : [];
  });
}

function dataItem(row: RowDataPacket, moduleFields: ModuleFieldValue[], names: Map<string, string>, userId: string): Record<string, unknown> {
  return {
    id: String(row.id),
    customFormId: String(row.custom_form_id),
    name: String(row.name),
    owner: String(row.owner),
    ownerName: names.get(String(row.owner)) ?? '',
    createUser: String(row.create_user),
    updateUser: String(row.update_user),
    createUserName: names.get(String(row.create_user)) ?? '',
    updateUserName: names.get(String(row.update_user)) ?? '',
    createTime: Number(row.create_time ?? 0),
    updateTime: Number(row.update_time ?? 0),
    moduleFields,
    isAdmin: userId === ADMIN_USER_ID,
  };
}
