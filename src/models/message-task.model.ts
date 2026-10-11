import type { RowDataPacket } from 'mysql2';

import { bitToBool } from '../support/bit.js';
import { execute, query } from '../support/db.js';
import { nextId } from '../support/id.js';

export interface MessageTaskFlags {
  emailEnable: boolean;
  sysEnable: boolean;
  weComEnable: boolean;
  dingTalkEnable: boolean;
  larkEnable: boolean;
}

export interface MessageTaskRecord extends MessageTaskFlags {
  id: string;
  event: string;
  taskType: string;
}

interface MessageTaskRow extends RowDataPacket {
  id: string;
  event: string;
  task_type: string;
  email_enable: unknown;
  sys_enable: unknown;
  we_com_enable: unknown;
  ding_talk_enable: unknown;
  lark_enable: unknown;
}

function mapTask(row: MessageTaskRow): MessageTaskRecord {
  return {
    id: row.id,
    event: row.event,
    taskType: row.task_type,
    emailEnable: bitToBool(row.email_enable),
    sysEnable: bitToBool(row.sys_enable),
    weComEnable: bitToBool(row.we_com_enable),
    dingTalkEnable: bitToBool(row.ding_talk_enable),
    larkEnable: bitToBool(row.lark_enable),
  };
}

export async function listMessageTasks(organizationId: string): Promise<MessageTaskRecord[]> {
  const rows = await query<MessageTaskRow>(
    `SELECT id, event, task_type, email_enable, sys_enable, we_com_enable, ding_talk_enable, lark_enable
     FROM sys_message_task WHERE organization_id = ?`,
    [organizationId],
  );
  return rows.map(mapTask);
}

export async function findMessageTask(organizationId: string, module: string, event: string): Promise<MessageTaskRecord | null> {
  const rows = await query<MessageTaskRow>(
    `SELECT id, event, task_type, email_enable, sys_enable, we_com_enable, ding_talk_enable, lark_enable
     FROM sys_message_task WHERE organization_id = ? AND task_type = ? AND event = ? LIMIT 1`,
    [organizationId, module, event],
  );
  return rows[0] ? mapTask(rows[0]) : null;
}

export async function insertMessageTask(input: {
  organizationId: string;
  module: string;
  event: string;
  flags: MessageTaskFlags;
  template: string;
  userId: string;
}): Promise<string> {
  const id = nextId();
  const now = Date.now();
  await execute(
    `INSERT INTO sys_message_task
      (id, event, task_type, email_enable, sys_enable, we_com_enable, ding_talk_enable, lark_enable,
       organization_id, template, create_user, create_time, update_user, update_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.event,
      input.module,
      input.flags.emailEnable ? 1 : 0,
      input.flags.sysEnable ? 1 : 0,
      input.flags.weComEnable ? 1 : 0,
      input.flags.dingTalkEnable ? 1 : 0,
      input.flags.larkEnable ? 1 : 0,
      input.organizationId,
      Buffer.from(input.template),
      input.userId,
      now,
      input.userId,
      now,
    ],
  );
  return id;
}

export async function updateMessageTaskFlags(id: string, flags: MessageTaskFlags, userId: string): Promise<void> {
  await execute(
    `UPDATE sys_message_task
     SET email_enable = ?, sys_enable = ?, we_com_enable = ?, ding_talk_enable = ?, lark_enable = ?,
         update_user = ?, update_time = ?
     WHERE id = ?`,
    [
      flags.emailEnable ? 1 : 0,
      flags.sysEnable ? 1 : 0,
      flags.weComEnable ? 1 : 0,
      flags.dingTalkEnable ? 1 : 0,
      flags.larkEnable ? 1 : 0,
      userId,
      Date.now(),
      id,
    ],
  );
}

export async function updateMessageTasksByOrganization(
  organizationId: string,
  patch: Partial<MessageTaskFlags>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const columns: Array<[keyof MessageTaskFlags, string]> = [
    ['emailEnable', 'email_enable'],
    ['sysEnable', 'sys_enable'],
    ['weComEnable', 'we_com_enable'],
    ['dingTalkEnable', 'ding_talk_enable'],
    ['larkEnable', 'lark_enable'],
  ];
  for (const [key, column] of columns) {
    if (patch[key] === undefined) {
      continue;
    }
    sets.push(`${column} = ?`);
    params.push(patch[key] ? 1 : 0);
  }
  if (sets.length === 0) {
    return;
  }
  params.push(organizationId);
  await execute(`UPDATE sys_message_task SET ${sets.join(', ')} WHERE organization_id = ?`, params);
}

export async function findMessageTaskConfig(organizationId: string, module: string, event: string): Promise<string | null> {
  const rows = await query<RowDataPacket & { value: string | null }>(
    `SELECT value FROM sys_message_task_config
     WHERE organization_id = ? AND task_type = ? AND event = ? LIMIT 1`,
    [organizationId, module, event],
  );
  return rows[0]?.value ?? null;
}

export async function saveMessageTaskConfig(
  organizationId: string,
  module: string,
  event: string,
  value: string,
): Promise<void> {
  const rows = await query<RowDataPacket & { id: string }>(
    `SELECT id FROM sys_message_task_config
     WHERE organization_id = ? AND task_type = ? AND event = ? LIMIT 1`,
    [organizationId, module, event],
  );
  if (rows[0]) {
    await execute('UPDATE sys_message_task_config SET value = ? WHERE id = ?', [value, rows[0].id]);
    return;
  }
  await execute(
    `INSERT INTO sys_message_task_config (id, organization_id, event, task_type, value) VALUES (?, ?, ?, ?, ?)`,
    [nextId(), organizationId, event, module, value],
  );
}
