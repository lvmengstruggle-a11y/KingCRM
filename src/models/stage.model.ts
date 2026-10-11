import type { RowDataPacket } from 'mysql2';

import { asNumber, bitToBool } from '../support/bit.js';
import { execute, query } from '../support/db.js';
import { notFound, validateFailed } from '../support/errors.js';
import { ident } from '../support/ident.js';
import { nextId } from '../support/id.js';
import { tableColumns } from './record.model.js';

export interface StageConfig {
  id: string;
  name: string;
  type: string;
  rate: string;
  afootRollBack: boolean;
  endRollBack: boolean;
  pos: number;
  organizationId: string;
  stageHasData: boolean;
  circulationType?: string;
}

export interface StageBoard {
  stageConfigList: StageConfig[];
  afootRollBack: boolean;
  endRollBack: boolean;
  circulationType: string;
  advancedConfigs: unknown[];
  optionMap: Record<string, unknown>;
}

function mapStage(row: RowDataPacket, used: Set<string>): StageConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    type: String(row.type),
    rate: String(row.rate ?? ''),
    afootRollBack: bitToBool(row.afoot_roll_back),
    endRollBack: bitToBool(row.end_roll_back),
    pos: asNumber(row.pos),
    organizationId: String(row.organization_id),
    stageHasData: used.has(String(row.id)),
    circulationType: row.circulation_type == null ? undefined : String(row.circulation_type),
  };
}

export async function listStages(table: string, recordTable: string, organizationId: string): Promise<StageBoard> {
  const columns = await tableColumns(table);
  const hasCirculation = columns.some((column) => column.column === 'circulation_type');
  const rows = await query<RowDataPacket>(
    `SELECT * FROM ${ident(table)} WHERE organization_id = ? ORDER BY pos`,
    [organizationId],
  );
  const usedRows = await query<RowDataPacket & { stage: string }>(
    `SELECT stage FROM ${ident(recordTable)} WHERE organization_id = ? AND stage IS NOT NULL`,
    [organizationId],
  );
  const used = new Set(usedRows.map((row) => String(row.stage)));
  const stageConfigList = rows.map((row) => mapStage(row, used));
  const first = stageConfigList[0];
  return {
    stageConfigList,
    afootRollBack: first?.afootRollBack ?? true,
    endRollBack: first?.endRollBack ?? false,
    circulationType: (hasCirculation ? first?.circulationType : undefined) || 'NORMAL',
    advancedConfigs: await listAdvanced(stageModule(table), organizationId),
    optionMap: {},
  };
}

function stageModule(table: string): string {
  if (table.startsWith('sales_order')) {
    return 'order';
  }
  if (table.startsWith('contract')) {
    return 'contract';
  }
  return 'opportunity';
}

export async function sortStages(table: string, organizationId: string, ids: string[]): Promise<void> {
  let pos = 4096;
  const now = Date.now();
  for (const id of ids) {
    await execute(
      `UPDATE ${ident(table)} SET pos = ?, update_time = ? WHERE id = ? AND organization_id = ?`,
      [pos, now, id, organizationId],
    );
    pos += 4096;
  }
}

export async function setCirculation(table: string, organizationId: string, type: string): Promise<void> {
  const columns = await tableColumns(table);
  if (!columns.some((column) => column.column === 'circulation_type')) {
    return;
  }
  await execute(
    `UPDATE ${ident(table)} SET circulation_type = ?, update_time = ? WHERE organization_id = ?`,
    [type === 'ADVANCED' ? 'ADVANCED' : 'NORMAL', Date.now(), organizationId],
  );
}

export async function saveAdvanced(table: string, organizationId: string, userId: string, body: Record<string, unknown>): Promise<void> {
  const moduleType = stageModule(table);
  const settings = Array.isArray(body.circulationSettings) ? body.circulationSettings : [];
  const now = Date.now();
  if (body.circulationType != null) {
    await setCirculation(table, organizationId, String(body.circulationType));
  }
  await execute('DELETE FROM stage_advanced_config WHERE module_type = ? AND organization_id = ?', [moduleType, organizationId]);
  for (const item of settings) {
    const setting = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const originId = String(setting.originId ?? '');
    const targets = Array.isArray(setting.targets) ? setting.targets : [];
    for (const targetItem of targets) {
      const target = targetItem && typeof targetItem === 'object' ? targetItem as Record<string, unknown> : {};
      const targetId = String(target.targetId ?? '');
      if (!originId || !targetId) {
        continue;
      }
      await execute(
        `INSERT INTO stage_advanced_config
         (id, origin_id, target_id, enable, field_config, module_type, organization_id, create_time, update_time, create_user, update_user)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nextId(),
          originId,
          targetId,
          target.enable === false ? 0 : 1,
          JSON.stringify(target.circulationFieldValues ?? []),
          moduleType,
          organizationId,
          now,
          now,
          userId,
          userId,
        ],
      );
    }
  }
}

async function listAdvanced(moduleType: string, organizationId: string): Promise<unknown[]> {
  const rows = await query<RowDataPacket>(
    `SELECT origin_id, target_id, enable, field_config
     FROM stage_advanced_config WHERE module_type = ? AND organization_id = ?`,
    [moduleType, organizationId],
  );
  const grouped = new Map<string, { originId: string; moduleType: string; targets: unknown[] }>();
  for (const row of rows) {
    const originId = String(row.origin_id);
    const current = grouped.get(originId) ?? { originId, moduleType, targets: [] };
    let fields: unknown[] = [];
    try {
      const parsed = JSON.parse(String(row.field_config ?? '[]'));
      fields = Array.isArray(parsed) ? parsed : [];
    } catch {
      fields = [];
    }
    current.targets.push({
      targetId: String(row.target_id),
      enable: bitToBool(row.enable),
      circulationFieldValues: fields,
    });
    grouped.set(originId, current);
  }
  return [...grouped.values()];
}

export async function addStage(table: string, organizationId: string, userId: string, body: Record<string, unknown>): Promise<string> {
  const name = String(body.name ?? '').trim();
  if (!name) {
    throw validateFailed('阶段名称不能为空');
  }
  const columns = await tableColumns(table);
  const id = nextId();
  const now = Date.now();
  const posRows = await query<RowDataPacket & { pos: number | string | null }>(
    `SELECT MAX(pos) AS pos FROM ${ident(table)} WHERE organization_id = ?`,
    [organizationId],
  );
  const values: Record<string, unknown> = {
    id,
    name,
    type: String(body.type ?? 'AFOOT'),
    rate: String(body.rate ?? '0'),
    afoot_roll_back: body.afootRollBack === false ? 0 : 1,
    end_roll_back: body.endRollBack === true ? 1 : 0,
    pos: asNumber(posRows[0]?.pos) + 4096,
    organization_id: organizationId,
    create_time: now,
    update_time: now,
    create_user: userId,
    update_user: userId,
  };
  const used = columns.filter((column) => values[column.column] !== undefined);
  await execute(
    `INSERT INTO ${ident(table)} (${used.map((column) => ident(column.column)).join(', ')})
     VALUES (${used.map(() => '?').join(', ')})`,
    used.map((column) => values[column.column]),
  );
  return id;
}

export async function deleteStage(table: string, recordTable: string, id: string, organizationId: string): Promise<void> {
  const used = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM ${ident(recordTable)} WHERE organization_id = ? AND stage = ?`,
    [organizationId, id],
  );
  if (asNumber(used[0]?.total) > 0) {
    throw validateFailed('阶段已被使用，不能删除');
  }
  const result = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM ${ident(table)} WHERE id = ? AND organization_id = ?`,
    [id, organizationId],
  );
  if (asNumber(result[0]?.total) === 0) {
    throw notFound('阶段不存在');
  }
  await execute(`DELETE FROM ${ident(table)} WHERE id = ? AND organization_id = ?`, [id, organizationId]);
}

export async function renameStage(table: string, organizationId: string, body: Record<string, unknown>): Promise<void> {
  const id = String(body.id ?? '').trim();
  const name = String(body.name ?? '').trim();
  if (!id || !name) {
    throw validateFailed('阶段名称不能为空');
  }
  const existing = await query<RowDataPacket & { id: string }>(
    `SELECT id FROM ${ident(table)} WHERE id = ? AND organization_id = ? LIMIT 1`,
    [id, organizationId],
  );
  if (!existing[0]) {
    throw notFound('阶段不存在');
  }
  const columns = await tableColumns(table);
  const sets = ['name = ?', 'update_time = ?'];
  const params: unknown[] = [name, Date.now()];
  if (body.rate != null && columns.some((column) => column.column === 'rate')) {
    sets.push('rate = ?');
    params.push(String(body.rate));
  }
  params.push(id, organizationId);
  await execute(
    `UPDATE ${ident(table)} SET ${sets.join(', ')} WHERE id = ? AND organization_id = ?`,
    params,
  );
}

export async function updateStageRollback(table: string, organizationId: string, body: Record<string, unknown>): Promise<void> {
  await execute(
    `UPDATE ${ident(table)} SET afoot_roll_back = ?, end_roll_back = ?, update_time = ? WHERE organization_id = ?`,
    [body.afootRollBack === false ? 0 : 1, body.endRollBack === true ? 1 : 0, Date.now(), organizationId],
  );
}

export async function firstStageId(table: string, organizationId: string): Promise<string | null> {
  const rows = await query<RowDataPacket & { id: string }>(
    `SELECT id FROM ${ident(table)} WHERE organization_id = ? ORDER BY pos LIMIT 1`,
    [organizationId],
  );
  return rows[0]?.id ?? null;
}
