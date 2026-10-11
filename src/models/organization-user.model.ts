import type { RowDataPacket } from 'mysql2';

import { asNumber, asString, bitToBool } from '../support/bit.js';
import { query } from '../support/db.js';
import type { PageQuery } from '../support/pager.js';

export interface UserPageRecord {
  id: string;
  userId: string;
  organizationId: string;
  departmentId: string | null;
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
  createTime: number;
  updateTime: number;
  createUser: string;
  updateUser: string;
  onboardingDate: number | null;
}

export interface UserOptionRecord {
  id: string;
  name: string;
  enable: boolean;
}

interface UserPageRow extends RowDataPacket {
  id: string;
  user_id: string;
  organization_id: string;
  department_id: string | null;
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
  create_time: number | string;
  update_time: number | string;
  create_user: string;
  update_user: string;
  onboarding_date: number | string | null;
}

const SORT_COLUMNS: Record<string, string> = {
  user_name: 'su.name',
  name: 'su.name',
  work_city: 'sou.work_city',
  work_city_name: 'sou.work_city',
  enable: 'sou.enable',
  create_time: 'sou.create_time',
  update_time: 'sou.update_time',
  position: 'sou.position',
  employee_id: 'sou.employee_id',
  phone: 'su.phone',
  email: 'su.email',
};

function mapPage(row: UserPageRow): UserPageRecord {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    departmentId: asString(row.department_id),
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
    createTime: asNumber(row.create_time),
    updateTime: asNumber(row.update_time),
    createUser: row.create_user,
    updateUser: row.update_user,
    onboardingDate: row.onboarding_date == null ? null : asNumber(row.onboarding_date),
  };
}

export async function pageOrganizationUsers(input: {
  organizationId: string;
  departmentIds: string[];
  keyword?: string;
  sort?: { name: string; type: string };
  page: PageQuery;
}): Promise<{ list: UserPageRecord[]; total: number }> {
  const departmentIds = input.departmentIds.filter((id) => /^[A-Za-z0-9_-]+$/.test(id));
  if (departmentIds.length === 0) {
    return { list: [], total: 0 };
  }
  const marks = departmentIds.map(() => '?').join(',');
  const where = [`sou.organization_id = ?`, `sou.department_id IN (${marks})`];
  const params: unknown[] = [input.organizationId, ...departmentIds];
  if (input.keyword) {
    where.push('(su.name LIKE ? OR su.phone LIKE ?)');
    const like = `%${input.keyword}%`;
    params.push(like, like);
  }
  const whereSql = where.join(' AND ');
  const countRows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total
     FROM sys_organization_user sou
              INNER JOIN sys_user su ON sou.user_id = su.id
     WHERE ${whereSql}`,
    params,
  );
  const order = orderBy(departmentIds, input.sort);
  const offset = (input.page.current - 1) * input.page.pageSize;
  const rows = await query<UserPageRow>(
    `SELECT sou.id,
            sou.user_id,
            sou.organization_id,
            sou.department_id,
            su.name AS userName,
            sou.enable,
            su.gender,
            su.phone,
            su.email,
            sou.supervisor_id,
            sou.employee_id,
            sou.position,
            sou.employee_type,
            sou.work_city,
            sou.create_time,
            sou.update_time,
            sou.create_user,
            sou.update_user,
            sou.onboarding_date
     FROM sys_organization_user sou
              INNER JOIN sys_user su ON sou.user_id = su.id
     WHERE ${whereSql}
     ORDER BY ${order}
     LIMIT ? OFFSET ?`,
    [...params, input.page.pageSize, offset],
  );
  return { list: rows.map(mapPage), total: asNumber(countRows[0]?.total) };
}

export async function listUserOptions(organizationId: string, includeDisabled: boolean): Promise<UserOptionRecord[]> {
  const rows = await query<RowDataPacket & { id: string; name: string; enable: unknown }>(
    `SELECT su.id, su.name, sou.enable AS enable
     FROM sys_user su
              INNER JOIN sys_organization_user sou ON su.id = sou.user_id
     WHERE sou.organization_id = ?
       ${includeDisabled ? '' : 'AND sou.enable = 1'}
     ORDER BY sou.enable DESC, sou.create_time DESC, su.name DESC`,
    [organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    enable: bitToBool(row.enable),
  }));
}

export async function listAdminOptions(organizationId: string, includeDisabled: boolean): Promise<UserOptionRecord[]> {
  const rows = await query<RowDataPacket & { id: string; name: string; enable: unknown }>(
    `SELECT su.id, su.name, sou.enable AS enable
     FROM sys_user su
              INNER JOIN sys_organization_user sou ON su.id = sou.user_id AND sou.organization_id = ?
              INNER JOIN sys_user_role sur ON su.id = sur.user_id AND sur.role_id = 'org_admin'
     WHERE 1 = 1
         ${includeDisabled ? '' : 'AND sou.enable = 1'}
     ORDER BY sou.enable DESC, su.name`,
    [organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    enable: bitToBool(row.enable),
  }));
}

export async function listUserNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => id))];
  if (unique.length === 0) {
    return new Map();
  }
  const marks = unique.map(() => '?').join(',');
  const rows = await query<RowDataPacket & { id: string; name: string }>(
    `SELECT id, name FROM sys_user WHERE id IN (${marks})`,
    unique,
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function listDepartmentNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => id))];
  if (unique.length === 0) {
    return new Map();
  }
  const marks = unique.map(() => '?').join(',');
  const rows = await query<RowDataPacket & { id: string; name: string }>(
    `SELECT id, name FROM sys_department WHERE id IN (${marks})`,
    unique,
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

function orderBy(departmentIds: string[], sort?: { name: string; type: string }): string {
  const field = `FIELD(sou.department_id, ${departmentIds.map((id) => `'${id}'`).join(',')})`;
  const column = sort ? SORT_COLUMNS[sort.name] : undefined;
  const direction = sort?.type?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const custom = column ? `${column} ${direction}, ` : '';
  return `${custom}sou.enable DESC, ${field}, sou.create_time DESC, su.name DESC`;
}
