import type { RowDataPacket } from 'mysql2';

import { asNumber, asString, bitToBool } from '../support/bit.js';
import { execute, query, type Tx } from '../support/db.js';

export interface EmployeeDetail {
  id: string;
  userId: string;
  organizationId: string;
  departmentId: string | null;
  departmentName: string | null;
  userName: string;
  enable: boolean;
  gender: boolean;
  phone: string | null;
  email: string | null;
  supervisorId: string | null;
  employeeId: string | null;
  position: string | null;
  employeeType: string | null;
  workCity: string | null;
  onboardingDate: number | null;
  createTime: number;
  updateTime: number;
  createUser: string;
  updateUser: string;
}

interface DetailRow extends RowDataPacket {
  id: string;
  user_id: string;
  organization_id: string;
  department_id: string | null;
  departmentName: string | null;
  userName: string;
  enable: unknown;
  gender: unknown;
  phone: string | null;
  email: string | null;
  supervisor_id: string | null;
  employee_id: string | null;
  position: string | null;
  employee_type: string | null;
  work_city: string | null;
  onboarding_date: number | string | null;
  create_time: number | string;
  update_time: number | string;
  create_user: string;
  update_user: string;
}

function mapDetail(row: DetailRow): EmployeeDetail {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    departmentId: asString(row.department_id),
    departmentName: asString(row.departmentName),
    userName: row.userName,
    enable: bitToBool(row.enable),
    gender: bitToBool(row.gender),
    phone: asString(row.phone),
    email: asString(row.email),
    supervisorId: asString(row.supervisor_id),
    employeeId: asString(row.employee_id),
    position: asString(row.position),
    employeeType: asString(row.employee_type),
    workCity: asString(row.work_city),
    onboardingDate: row.onboarding_date == null ? null : asNumber(row.onboarding_date),
    createTime: asNumber(row.create_time),
    updateTime: asNumber(row.update_time),
    createUser: row.create_user,
    updateUser: row.update_user,
  };
}

const DETAIL_SQL = `SELECT sou.id, sou.user_id, sou.organization_id, sou.department_id,
            su.name AS userName, sou.enable, su.gender, su.phone, su.email,
            sou.supervisor_id, sou.employee_id, sou.position, sou.employee_type, sou.work_city,
            sou.onboarding_date, sou.create_time, sou.update_time, sou.create_user, sou.update_user,
            sd.name AS departmentName
     FROM sys_user su
              INNER JOIN sys_organization_user sou ON su.id = sou.user_id
              LEFT JOIN sys_department sd ON sd.id = sou.department_id`;

export async function findEmployee(organizationUserId: string): Promise<EmployeeDetail | null> {
  const rows = await query<DetailRow>(`${DETAIL_SQL} WHERE sou.id = ? LIMIT 1`, [organizationUserId]);
  return rows[0] ? mapDetail(rows[0]) : null;
}

export async function findEmployeeByUser(userId: string, organizationId: string): Promise<EmployeeDetail | null> {
  const rows = await query<DetailRow>(
    `${DETAIL_SQL} WHERE sou.user_id = ? AND sou.organization_id = ? LIMIT 1`,
    [userId, organizationId],
  );
  return rows[0] ? mapDetail(rows[0]) : null;
}

export async function findEmployeesByContact(organizationId: string, phone: string, email: string): Promise<EmployeeDetail[]> {
  const filters: string[] = [];
  const params: unknown[] = [organizationId];
  if (phone) {
    filters.push('su.phone = ?');
    params.push(phone);
  }
  if (email) {
    filters.push('su.email = ?');
    params.push(email);
  }
  if (filters.length === 0) {
    return [];
  }
  const rows = await query<DetailRow>(
    `${DETAIL_SQL} WHERE sou.organization_id = ? AND (${filters.join(' OR ')}) LIMIT 5`,
    params,
  );
  return rows.map(mapDetail);
}

export async function updateUserContact(userId: string, phone: string, email: string, operatorId: string): Promise<void> {
  await execute(
    'UPDATE sys_user SET phone = ?, email = ?, update_time = ?, update_user = ? WHERE id = ?',
    [phone, email, Date.now(), operatorId, userId],
  );
}

export async function countEmail(email: string, excludeUserId: string): Promise<number> {
  const rows = await query<RowDataPacket & { total: number }>(
    'SELECT COUNT(*) AS total FROM sys_user WHERE email = ? AND id <> ?',
    [email, excludeUserId],
  );
  return asNumber(rows[0]?.total);
}

export async function countPhone(phone: string, excludeUserId: string): Promise<number> {
  const rows = await query<RowDataPacket & { total: number }>(
    'SELECT COUNT(*) AS total FROM sys_user WHERE phone = ? AND id <> ?',
    [phone, excludeUserId],
  );
  return asNumber(rows[0]?.total);
}

export async function insertEmployee(tx: Tx, input: {
  userId: string;
  orgUserId: string;
  name: string;
  phone: string;
  email: string;
  gender: boolean;
  password: string;
  language: string;
  organizationId: string;
  departmentId: string;
  employeeId: string;
  employeeType: string;
  supervisorId: string;
  position: string;
  workCity: string;
  enable: boolean;
  onboardingDate: number | null;
  operatorId: string;
}): Promise<void> {
  const now = Date.now();
  await tx.execute(
    `INSERT INTO sys_user
       (id, name, phone, email, password, language, last_organization_id, gender, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.userId, input.name, input.phone, input.email, input.password, input.language, input.organizationId,
      input.gender ? 1 : 0, now, now, input.operatorId, input.operatorId],
  );
  await tx.execute(
    `INSERT INTO sys_organization_user
       (id, organization_id, department_id, user_id, enable, employee_id, position, employee_type, supervisor_id, work_city,
        onboarding_date, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.orgUserId, input.organizationId, input.departmentId, input.userId, input.enable ? 1 : 0,
      input.employeeId, input.position, input.employeeType, input.supervisorId, input.workCity,
      input.onboardingDate, now, now, input.operatorId, input.operatorId],
  );
}

export async function updateEmployee(tx: Tx, input: {
  orgUserId: string;
  userId: string;
  name: string;
  phone: string;
  email: string;
  gender: boolean;
  departmentId: string;
  employeeId: string;
  employeeType: string;
  supervisorId: string;
  position: string;
  workCity: string;
  enable: boolean;
  onboardingDate: number | null;
  operatorId: string;
}): Promise<void> {
  const now = Date.now();
  await tx.execute(
    `UPDATE sys_user
     SET name = ?, phone = ?, email = ?, gender = ?, update_time = ?, update_user = ?
     WHERE id = ?`,
    [input.name, input.phone, input.email, input.gender ? 1 : 0, now, input.operatorId, input.userId],
  );
  await tx.execute(
    `UPDATE sys_organization_user
     SET department_id = ?, enable = ?, employee_id = ?, position = ?, employee_type = ?, supervisor_id = ?,
         work_city = ?, onboarding_date = ?, update_time = ?, update_user = ?
     WHERE id = ?`,
    [input.departmentId, input.enable ? 1 : 0, input.employeeId, input.position, input.employeeType,
      input.supervisorId, input.workCity, input.onboardingDate, now, input.operatorId, input.orgUserId],
  );
}

export async function updatePassword(userId: string, password: string, operatorId: string): Promise<void> {
  await execute(
    'UPDATE sys_user SET password = ?, update_time = ?, update_user = ? WHERE id = ?',
    [password, Date.now(), operatorId, userId],
  );
}

export async function findPhone(userId: string): Promise<{ phone: string | null; name: string } | null> {
  const rows = await query<RowDataPacket & { phone: string | null; name: string }>(
    'SELECT phone, name FROM sys_user WHERE id = ? LIMIT 1',
    [userId],
  );
  const row = rows[0];
  return row ? { phone: asString(row.phone), name: row.name } : null;
}

export async function setEnable(ids: string[], enable: boolean, operatorId: string): Promise<string[]> {
  if (ids.length === 0) {
    return [];
  }
  const marks = ids.map(() => '?').join(',');
  const rows = await query<RowDataPacket & { user_id: string }>(
    `SELECT user_id FROM sys_organization_user WHERE id IN (${marks})`,
    ids,
  );
  await execute(
    `UPDATE sys_organization_user SET enable = ?, update_time = ?, update_user = ? WHERE id IN (${marks})`,
    [enable ? 1 : 0, Date.now(), operatorId, ...ids],
  );
  return rows.map((row) => row.user_id);
}

export async function updateUserName(userId: string, name: string, operatorId: string): Promise<void> {
  await execute(
    'UPDATE sys_user SET name = ?, update_time = ?, update_user = ? WHERE id = ?',
    [name, Date.now(), operatorId, userId],
  );
}

export async function countOwnedResources(userId: string): Promise<number> {
  const tables = ['opportunity', 'customer', 'clue'];
  let total = 0;
  for (const table of tables) {
    const rows = await query<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM ${table} WHERE owner = ?`,
      [userId],
    );
    total += asNumber(rows[0]?.total);
  }
  return total;
}

export async function deleteEmployee(tx: Tx, orgUserId: string, userId: string, organizationId: string): Promise<void> {
  await tx.execute(
    `DELETE sur FROM sys_user_role sur
              INNER JOIN sys_role sr ON sr.id = sur.role_id
     WHERE sur.user_id = ? AND sr.organization_id = ?`,
    [userId, organizationId],
  );
  await tx.execute('DELETE FROM sys_department_commander WHERE user_id = ?', [userId]);
  await tx.execute('DELETE FROM sys_organization_user WHERE id = ?', [orgUserId]);
  const left = await tx.query<RowDataPacket & { total: number }>(
    'SELECT COUNT(*) AS total FROM sys_organization_user WHERE user_id = ?',
    [userId],
  );
  if (asNumber(left[0]?.total) === 0) {
    await tx.execute('DELETE FROM sys_user_extend WHERE id = ?', [userId]);
    await tx.execute('DELETE FROM sys_user WHERE id = ?', [userId]);
  }
}

export async function listDeptUserNodes(organizationId: string, includeDisabled: boolean): Promise<Array<{
  id: string;
  name: string;
  parentId: string;
  nodeType: 'ORG' | 'USER';
  enabled: boolean;
}>> {
  const departments = await query<RowDataPacket & { id: string; name: string; parent_id: string }>(
    `SELECT id, name, parent_id FROM sys_department WHERE organization_id = ? ORDER BY pos`,
    [organizationId],
  );
  const users = await query<RowDataPacket & { id: string; name: string; parent_id: string; enable: unknown }>(
    `SELECT su.id, su.name, sou.department_id AS parent_id, sou.enable
     FROM sys_user su
              INNER JOIN sys_organization_user sou ON su.id = sou.user_id
     WHERE sou.organization_id = ?
       ${includeDisabled ? '' : 'AND sou.enable = 1'}`,
    [organizationId],
  );
  return [
    ...departments.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      nodeType: 'ORG' as const,
      enabled: true,
    })),
    ...users.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id ?? 'NONE',
      nodeType: 'USER' as const,
      enabled: bitToBool(row.enable),
    })),
  ];
}

export async function batchEditEmployees(input: {
  ids: string[];
  organizationId: string;
  operatorId: string;
  departmentId?: string;
  supervisorId?: string;
  workCity?: string;
  onboardingDate?: number | null;
}): Promise<boolean> {
  if (input.departmentId) {
    const departments = await query<RowDataPacket & { id: string }>(
      'SELECT id FROM sys_department WHERE id = ? AND organization_id = ? LIMIT 1',
      [input.departmentId, input.organizationId],
    );
    if (!departments[0]) {
      return false;
    }
  }
  const sets = ['update_time = ?', 'update_user = ?'];
  const params: unknown[] = [Date.now(), input.operatorId];
  if (input.departmentId !== undefined) {
    sets.push('department_id = ?');
    params.push(input.departmentId);
  }
  if (input.supervisorId !== undefined) {
    sets.push('supervisor_id = ?');
    params.push(input.supervisorId);
  }
  if (input.workCity !== undefined) {
    sets.push('work_city = ?');
    params.push(input.workCity);
  }
  if (input.onboardingDate !== undefined) {
    sets.push('onboarding_date = ?');
    params.push(input.onboardingDate);
  }
  const marks = input.ids.map(() => '?').join(',');
  await execute(
    `UPDATE sys_organization_user SET ${sets.join(', ')} WHERE organization_id = ? AND id IN (${marks})`,
    [...params, input.organizationId, ...input.ids],
  );
  return true;
}
