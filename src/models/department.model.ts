import type { RowDataPacket } from 'mysql2';

import { asNumber } from '../support/bit.js';
import { execute, query, type Tx } from '../support/db.js';

export interface DepartmentRecord {
  id: string;
  name: string;
  parentId: string;
  organizationId: string;
  pos: number;
  resource: string;
}

interface DepartmentRow extends RowDataPacket {
  id: string;
  name: string;
  parent_id: string;
  organization_id: string;
  pos: number | string;
  resource: string;
}

function mapDepartment(row: DepartmentRow): DepartmentRecord {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    organizationId: row.organization_id,
    pos: asNumber(row.pos),
    resource: row.resource,
  };
}

const COLUMNS = 'id, name, parent_id, organization_id, pos, resource';

export async function listDepartments(organizationId: string): Promise<DepartmentRecord[]> {
  const rows = await query<DepartmentRow>(
    `SELECT ${COLUMNS} FROM sys_department WHERE organization_id = ? ORDER BY pos`,
    [organizationId],
  );
  return rows.map(mapDepartment);
}

export async function findDepartment(id: string): Promise<DepartmentRecord | null> {
  const rows = await query<DepartmentRow>(
    `SELECT ${COLUMNS} FROM sys_department WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? mapDepartment(rows[0]) : null;
}

export async function countDepartmentName(
  name: string,
  parentId: string,
  organizationId: string,
  excludeId?: string,
): Promise<number> {
  const rows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total
     FROM sys_department
     WHERE name = ? AND parent_id = ? AND organization_id = ?
       AND (? IS NULL OR id <> ?)`,
    [name, parentId, organizationId, excludeId ?? null, excludeId ?? null],
  );
  return asNumber(rows[0]?.total);
}

export async function nextDepartmentPos(organizationId: string): Promise<number> {
  const rows = await query<RowDataPacket & { pos: number | string | null }>(
    'SELECT MAX(pos) AS pos FROM sys_department WHERE organization_id = ?',
    [organizationId],
  );
  return asNumber(rows[0]?.pos) + 4096;
}

export async function insertDepartment(input: {
  id: string;
  name: string;
  parentId: string;
  organizationId: string;
  pos: number;
  userId: string;
}): Promise<void> {
  const now = Date.now();
  await execute(
    `INSERT INTO sys_department
       (id, name, organization_id, parent_id, pos, create_time, update_time, create_user, update_user, resource)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'INTERNAL')`,
    [input.id, input.name, input.organizationId, input.parentId, input.pos, now, now, input.userId, input.userId],
  );
}

export async function renameDepartment(id: string, name: string, userId: string): Promise<void> {
  await execute(
    'UPDATE sys_department SET name = ?, update_time = ?, update_user = ? WHERE id = ?',
    [name, Date.now(), userId, id],
  );
}

export async function countUsersInDepartments(ids: string[], organizationId: string): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const marks = ids.map(() => '?').join(',');
  const rows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(user_id) AS total
     FROM sys_organization_user
     WHERE organization_id = ? AND department_id IN (${marks})`,
    [organizationId, ...ids],
  );
  return asNumber(rows[0]?.total);
}

export async function deleteDepartments(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const marks = ids.map(() => '?').join(',');
  await tx.execute(`DELETE FROM sys_department_commander WHERE department_id IN (${marks})`, ids);
  await tx.execute(`DELETE FROM sys_department WHERE id IN (${marks})`, ids);
}

export async function replaceCommander(tx: Tx, input: {
  departmentId: string;
  commanderId: string;
  userId: string;
  id: string;
}): Promise<void> {
  const now = Date.now();
  await tx.execute('DELETE FROM sys_department_commander WHERE department_id = ?', [input.departmentId]);
  await tx.execute(
    `INSERT INTO sys_department_commander
       (id, user_id, department_id, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.id, input.commanderId, input.departmentId, now, now, input.userId, input.userId],
  );
}

export async function updateDepartmentPlacement(
  tx: Tx,
  input: { id: string; parentId: string; pos: number; userId: string },
): Promise<void> {
  await tx.execute(
    'UPDATE sys_department SET parent_id = ?, pos = ?, update_time = ?, update_user = ? WHERE id = ?',
    [input.parentId, input.pos, Date.now(), input.userId, input.id],
  );
}

export async function listCommanderUserIds(departmentId: string): Promise<string[]> {
  const rows = await query<RowDataPacket & { user_id: string }>(
    'SELECT user_id FROM sys_department_commander WHERE department_id = ?',
    [departmentId],
  );
  return rows.map((row) => row.user_id);
}
