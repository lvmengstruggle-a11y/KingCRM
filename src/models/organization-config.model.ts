import type { RowDataPacket } from 'mysql2';

import { asNumber, bitToBool } from '../support/bit.js';
import { execute, query } from '../support/db.js';
import { nextId } from '../support/id.js';

export interface OrganizationConfigRecord {
  id: string;
  type: string;
  organizationId: string;
  sync: boolean;
  syncResource: string | null;
  enable: boolean;
  createTime: number;
  updateTime: number;
  createUser: string;
  updateUser: string;
}

interface ConfigRow extends RowDataPacket {
  id: string;
  type: string;
  organization_id: string;
  sync: unknown;
  sync_resource: string | null;
  enable: unknown;
  create_time: unknown;
  update_time: unknown;
  create_user: string;
  update_user: string;
}

function mapConfig(row: ConfigRow): OrganizationConfigRecord {
  return {
    id: row.id,
    type: row.type,
    organizationId: row.organization_id,
    sync: bitToBool(row.sync),
    syncResource: row.sync_resource,
    enable: bitToBool(row.enable),
    createTime: asNumber(row.create_time),
    updateTime: asNumber(row.update_time),
    createUser: row.create_user,
    updateUser: row.update_user,
  };
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

export async function findOrganizationConfig(organizationId: string, type: string): Promise<OrganizationConfigRecord | null> {
  const rows = await query<ConfigRow>(
    `SELECT * FROM sys_organization_config WHERE organization_id = ? AND type = ? LIMIT 1`,
    [organizationId, type],
  );
  return rows[0] ? mapConfig(rows[0]) : null;
}

export async function insertOrganizationConfig(input: {
  organizationId: string;
  type: string;
  userId: string;
}): Promise<string> {
  const id = nextId();
  const now = Date.now();
  await execute(
    `INSERT INTO sys_organization_config
      (id, type, organization_id, sync, enable, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)`,
    [id, input.type, input.organizationId, now, now, input.userId, input.userId],
  );
  return id;
}

export async function updateSyncResource(id: string, syncResource: string, userId: string): Promise<void> {
  await execute(
    `UPDATE sys_organization_config SET sync_resource = ?, update_time = ?, update_user = ? WHERE id = ?`,
    [syncResource, Date.now(), userId, id],
  );
}

export async function listConfigContents(configId: string): Promise<Array<{ id: string; type: string; content: string }>> {
  const rows = await query<RowDataPacket & { id: string; type: string; content: unknown }>(
    'SELECT id, type, content FROM sys_organization_config_detail WHERE config_id = ?',
    [configId],
  );
  return rows.map((row) => ({ id: row.id, type: row.type, content: blobText(row.content) }));
}

export async function findConfigContent(configId: string, type: string): Promise<{ id: string; content: string } | null> {
  const rows = await query<RowDataPacket & { id: string; content: unknown }>(
    'SELECT id, content FROM sys_organization_config_detail WHERE config_id = ? AND type = ? LIMIT 1',
    [configId, type],
  );
  return rows[0] ? { id: rows[0].id, content: blobText(rows[0].content) } : null;
}

export async function insertConfigContent(input: {
  configId: string;
  type: string;
  name: string;
  content: string;
  userId: string;
}): Promise<void> {
  const now = Date.now();
  await execute(
    `INSERT INTO sys_organization_config_detail
      (id, config_id, type, enable, name, content, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    [nextId(), input.configId, input.type, input.name, Buffer.from(input.content), now, now, input.userId, input.userId],
  );
}

export async function updateConfigContent(id: string, content: string, userId: string): Promise<void> {
  await execute(
    'UPDATE sys_organization_config_detail SET content = ?, update_time = ?, update_user = ? WHERE id = ?',
    [Buffer.from(content), Date.now(), userId, id],
  );
}
