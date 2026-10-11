import { lookup } from 'node:dns/promises';

import { deleteModuleFields, deleteRecords } from '../models/record.model.js';
import { ADMIN_USER_ID } from '../config/index.js';
import { execute, query, withTransaction, type SqlRow, type Tx } from '../support/db.js';
import { notFound, validateFailed, failed } from '../support/errors.js';
import { nextId } from '../support/id.js';
import { translate } from '../support/i18n.js';
import { normalizePage, toPager, type Pager } from '../support/pager.js';
import { permissionCatalog } from '../support/permission-catalog.js';
import { assertPublicHost, isBlockedAddress } from '../support/smtp.js';

const FORMS: Record<string, { prefix: string; permissionId: string; table: string; fieldTable: string; blobTable: string; name: string }> = {
  quotation: { prefix: 'QTE-APV', permissionId: 'OPPORTUNITY_MANAGEMENT_QUOTATION', table: 'opportunity_quotation', fieldTable: 'opportunity_quotation_field', blobTable: 'opportunity_quotation_field_blob', name: '报价' },
  contract: { prefix: 'CTR-APV', permissionId: 'CONTRACT', table: 'contract', fieldTable: 'contract_field', blobTable: 'contract_field_blob', name: '合同' },
  invoice: { prefix: 'INV-APV', permissionId: 'CONTRACT_INVOICE', table: 'contract_invoice', fieldTable: 'contract_invoice_field', blobTable: 'contract_invoice_field_blob', name: '发票' },
  order: { prefix: 'ORD-APV', permissionId: 'ORDER', table: 'sales_order', fieldTable: 'sales_order_field', blobTable: 'sales_order_field_blob', name: '订单' },
};

interface PageFilter {
  name?: string;
  value?: unknown;
}

interface FlowPageQuery {
  current?: number;
  pageSize?: number;
  keyword?: string;
  filters?: PageFilter[];
  sort?: { name?: string; type?: string };
}

interface FlowInput {
  id?: string;
  name?: string;
  formType?: string;
  description?: string;
  createExecute?: boolean;
  updateExecute?: boolean;
  deleteExecute?: boolean;
  enable?: boolean;
  submitterCanRevoke?: boolean;
  allowBatchProcess?: boolean;
  allowWithdraw?: boolean;
  allowAddSign?: boolean;
  duplicateApproverRule?: string;
  requireComment?: boolean;
  statusPermissions?: unknown[];
  createNodeConfig?: NodeConfig;
  updateNodeConfig?: NodeConfig;
  deleteNodeConfig?: NodeConfig;
}

interface NodeConfig {
  nodes?: Record<string, unknown>[];
  links?: { fromNodeId?: string; toNodeId?: string }[];
}

interface FlowRow extends SqlRow {
  id: string;
  current_version_id: string;
  number: string;
  name: string;
  form_type: string;
  create_execute: number;
  update_execute: number;
  delete_execute: number;
  submitter_can_revoke: number;
  allow_batch_process: number;
  allow_withdraw: number;
  allow_add_sign: number;
  duplicate_approver_rule: string;
  require_comment: number;
  enable: number;
  create_time: number | string;
  update_time: number | string;
  create_user: string;
  update_user: string;
  organization_id: string;
  status_permissions: string;
  description: string | null;
}

function flag(value: unknown, fallback: boolean): number {
  if (value === undefined || value === null) {
    return fallback ? 1 : 0;
  }
  return value === false || value === 0 || value === 'false' ? 0 : 1;
}

function bool(value: number | null | undefined): boolean {
  return Number(value) === 1;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) {
    return new Map();
  }
  const rows = await query<SqlRow & { id: string; name: string }>(
    `SELECT id, name FROM sys_user WHERE id IN (${unique.map(() => '?').join(', ')})`,
    unique,
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

interface CatalogNode {
  id: string;
  permissions?: { id: string; name?: string }[];
  children?: CatalogNode[];
}

function formPermissions(formType: string): { id: string; name: string; enabled: boolean }[] {
  const moduleId = FORMS[formType]?.permissionId;
  if (!moduleId) {
    return ['READ', 'UPDATE', 'DELETE'].map((action) => ({
      id: `CUSTOM_FORM_DATA:${action}`,
      name: translate(`permission.${action.toLowerCase()}`),
      enabled: false,
    }));
  }
  const match = findPermissionNode(permissionCatalog() as CatalogNode[], moduleId);
  return (match?.permissions ?? [])
    .filter((item) => !item.id.includes('IMPORT'))
    .map((item) => ({ id: item.id, name: item.name ?? item.id, enabled: false }));
}

function findPermissionNode(nodes: CatalogNode[], id: string): CatalogNode | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const child = findPermissionNode(node.children ?? [], id);
    if (child) {
      return child;
    }
  }
  return undefined;
}

async function requireFlow(id: string, organizationId: string): Promise<FlowRow> {
  const rows = await query<FlowRow>(
    'SELECT * FROM approval_flow WHERE id = ? AND organization_id = ? AND deleted = 0',
    [id, organizationId],
  );
  const row = rows[0];
  if (!row) {
    throw notFound('审批流不存在');
  }
  return row;
}

async function disableOtherEnabled(formType: string, organizationId: string, exceptId: string, userId: string): Promise<void> {
  await execute(
    `UPDATE approval_flow SET enable = 0, update_time = ?, update_user = ?
     WHERE organization_id = ? AND form_type = ? AND deleted = 0 AND enable = 1 AND id <> ?`,
    [Date.now(), userId, organizationId, formType, exceptId],
  );
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') {
        return String(item);
      }
      if (item && typeof item === 'object' && 'id' in item) {
        return String((item as { id: unknown }).id ?? '');
      }
      return '';
    })
    .filter(Boolean);
}

function optionItems(ids: string[], names: Map<string, string>): Array<{ id: string; name: string }> {
  return ids.map((id) => ({ id, name: names.get(id) ?? id }));
}

function toListItem(row: FlowRow, names: Map<string, string>): Record<string, unknown> {
  return {
    id: row.id,
    currentVersionId: row.current_version_id,
    number: row.number,
    name: row.name,
    formType: row.form_type,
    description: row.description ?? '',
    createExecute: bool(row.create_execute),
    updateExecute: bool(row.update_execute),
    deleteExecute: bool(row.delete_execute),
    enable: bool(row.enable),
    submitterCanRevoke: bool(row.submitter_can_revoke),
    allowBatchProcess: bool(row.allow_batch_process),
    allowWithdraw: bool(row.allow_withdraw),
    allowAddSign: bool(row.allow_add_sign),
    duplicateApproverRule: row.duplicate_approver_rule,
    requireComment: bool(row.require_comment),
    organizationId: row.organization_id,
    statusPermissions: parseJson(row.status_permissions, []),
    createUser: row.create_user,
    updateUser: row.update_user,
    createUserName: names.get(row.create_user) ?? row.create_user,
    updateUserName: names.get(row.update_user) ?? row.update_user,
    createTime: Number(row.create_time),
    updateTime: Number(row.update_time),
  };
}

async function saveGraph(tx: Tx, versionId: string, executeTime: string, config: NodeConfig | undefined): Promise<void> {
  const nodes = config?.nodes ?? [];
  if (!nodes.length) {
    return;
  }
  const idMap = new Map<string, string>();
  let sort = 0;
  for (const node of nodes) {
    const frontId = text(node.id) || nextId();
    const id = nextId();
    idMap.set(frontId, id);
    const nodeType = text(node.nodeType, 'APPROVER') || 'APPROVER';
    const number = text(node.number) || `PN${String(sort + 1).padStart(3, '0')}`;
    await tx.execute(
      `INSERT INTO approval_node (id, flow_version_id, number, name, node_type, sort, execute_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, versionId, number, text(node.name, nodeType) || nodeType, nodeType, sort, executeTime],
    );
    sort += 1;
    if (nodeType === 'APPROVER') {
      await tx.execute(
        `INSERT INTO approval_node_approver
          (id, flow_version_id, approval_type, multi_approver_mode, empty_approver_action, fallback_approver,
           same_submitter_action, approver_type, approver_direction, cc_type, cc_direction, cc_list, approver_list,
           pass_post_config, reject_post_config, field_permissions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, versionId,
          text(node.approvalType, 'MANUAL') || 'MANUAL',
          text(node.multiApproverMode, 'ALL') || 'ALL',
          text(node.emptyApproverAction, 'AUTO_PASS') || 'AUTO_PASS',
          text(node.fallbackApprover) || null,
          text(node.sameSubmitterAction, 'SKIP') || 'SKIP',
          text(node.approverType) || null,
          text(node.approverDirection, 'BOTTOM_UP') || 'BOTTOM_UP',
          text(node.ccType) || null,
          text(node.ccDirection, 'BOTTOM_UP') || 'BOTTOM_UP',
          JSON.stringify(node.ccList ?? []),
          JSON.stringify(node.approverList ?? []),
          node.passPostConfig == null ? null : JSON.stringify(node.passPostConfig),
          node.rejectPostConfig == null ? null : JSON.stringify(node.rejectPostConfig),
          node.fieldPermissions == null ? null : JSON.stringify(node.fieldPermissions),
        ],
      );
    }
    if (nodeType === 'CONDITION') {
      await tx.execute(
        'INSERT INTO approval_node_condition (id, flow_version_id, condition_config) VALUES (?, ?, ?)',
        [id, versionId, node.conditionConfig == null ? null : JSON.stringify(node.conditionConfig)],
      );
    }
  }
  let linkSort = 0;
  for (const link of config?.links ?? []) {
    const fromNodeId = idMap.get(text(link.fromNodeId));
    const toNodeId = idMap.get(text(link.toNodeId));
    if (!fromNodeId || !toNodeId) {
      continue;
    }
    await tx.execute(
      `INSERT INTO approval_node_link (id, flow_version_id, from_node_id, to_node_id, sort) VALUES (?, ?, ?, ?, ?)`,
      [nextId(), versionId, fromNodeId, toNodeId, linkSort],
    );
    linkSort += 1;
  }
}

async function loadGraph(versionId: string): Promise<Record<string, { nodes: Record<string, unknown>[]; links: Record<string, unknown>[] }>> {
  const nodes = await query<SqlRow & {
    id: string; number: string; name: string; node_type: string; sort: number; execute_time: string | null;
  }>(
    'SELECT id, number, name, node_type, sort, execute_time FROM approval_node WHERE flow_version_id = ? ORDER BY sort',
    [versionId],
  );
  const approvers = await query<SqlRow>(
    'SELECT * FROM approval_node_approver WHERE flow_version_id = ?',
    [versionId],
  );
  const conditions = await query<SqlRow & { id: string; condition_config: string | null }>(
    'SELECT id, condition_config FROM approval_node_condition WHERE flow_version_id = ?',
    [versionId],
  );
  const links = await query<SqlRow & { id: string; from_node_id: string; to_node_id: string }>(
    'SELECT id, from_node_id, to_node_id FROM approval_node_link WHERE flow_version_id = ? ORDER BY sort',
    [versionId],
  );
  const approverById = new Map(approvers.map((row) => [String(row.id), row]));
  const conditionById = new Map(conditions.map((row) => [row.id, row]));
  const grouped: Record<string, { nodes: Record<string, unknown>[]; links: Record<string, unknown>[] }> = {
    CREATE: { nodes: [], links: [] },
    UPDATE: { nodes: [], links: [] },
    DELETE: { nodes: [], links: [] },
  };
  const timingOf = new Map<string, string>();
  for (const node of nodes) {
    const timing = node.execute_time || 'CREATE';
    timingOf.set(node.id, timing);
    const base: Record<string, unknown> = {
      id: node.id,
      number: node.number,
      name: node.name,
      nodeType: node.node_type,
      sort: Number(node.sort),
      executeTime: timing,
    };
    if (node.node_type === 'APPROVER') {
      const extra = approverById.get(node.id);
      Object.assign(base, extra ? {
        approvalType: extra.approval_type,
        multiApproverMode: extra.multi_approver_mode,
        emptyApproverAction: extra.empty_approver_action,
        fallbackApprover: extra.fallback_approver,
        sameSubmitterAction: extra.same_submitter_action,
        approverType: extra.approver_type,
        approverDirection: extra.approver_direction,
        approverList: parseJson(String(extra.approver_list ?? ''), []),
        ccType: extra.cc_type,
        ccDirection: extra.cc_direction,
        ccList: parseJson(String(extra.cc_list ?? ''), []),
        passPostConfig: parseJson(extra.pass_post_config == null ? null : String(extra.pass_post_config), null),
        rejectPostConfig: parseJson(extra.reject_post_config == null ? null : String(extra.reject_post_config), null),
        fieldPermissions: parseJson(extra.field_permissions == null ? null : String(extra.field_permissions), []),
      } : {});
    }
    if (node.node_type === 'CONDITION') {
      base.conditionConfig = parseJson(conditionById.get(node.id)?.condition_config, null);
    }
    (grouped[timing] ?? grouped.CREATE).nodes.push(base);
  }
  for (const link of links) {
    const timing = timingOf.get(link.from_node_id) || 'CREATE';
    (grouped[timing] ?? grouped.CREATE).links.push({
      id: link.id,
      fromNodeId: link.from_node_id,
      toNodeId: link.to_node_id,
    });
  }
  const userIds: string[] = [];
  const roleIds: string[] = [];
  const collect = (type: unknown, ids: string[]) => {
    if (type === 'ROLE') {
      roleIds.push(...ids);
    } else if (type === 'MEMBER' || !type) {
      userIds.push(...ids);
    }
  };
  for (const group of Object.values(grouped)) {
    for (const node of group.nodes) {
      if (node.nodeType !== 'APPROVER') {
        continue;
      }
      collect(node.approverType, idList(node.approverList));
      collect(node.ccType, idList(node.ccList));
      if (node.fallbackApprover) {
        userIds.push(String(node.fallbackApprover));
      }
    }
  }
  const users = await userNames(userIds);
  const roles = await roleNames(roleIds);
  for (const group of Object.values(grouped)) {
    for (const node of group.nodes) {
      if (node.nodeType !== 'APPROVER') {
        continue;
      }
      const names = node.approverType === 'ROLE' ? roles : users;
      const ccNames = node.ccType === 'ROLE' ? roles : users;
      node.approverSelectOptions = optionItems(idList(node.approverList), names);
      node.ccSelectOptions = optionItems(idList(node.ccList), ccNames);
      const fallback = String(node.fallbackApprover ?? '');
      node.fallbackApproverName = fallback ? (users.get(fallback) ?? '') : '';
    }
  }
  return grouped;
}

async function roleNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) {
    return new Map();
  }
  const rows = await query<SqlRow & { id: string; name: string }>(
    `SELECT id, name FROM sys_role WHERE id IN (${unique.map(() => '?').join(', ')})`,
    unique,
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function nextNumber(formType: string, organizationId: string): Promise<string> {
  const prefix = FORMS[formType]?.prefix ?? 'APV';
  const rows = await query<SqlRow & { total: number }>(
    'SELECT COUNT(*) AS total FROM approval_flow WHERE organization_id = ? AND form_type = ?',
    [organizationId, formType],
  );
  return `${prefix}-${String(Number(rows[0]?.total ?? 0) + 1).padStart(5, '0')}`;
}

const statusColumns = new Map<string, boolean>();
const approvedColumns = new Map<string, boolean>();

async function hasColumn(table: string, column: string, cache: Map<string, boolean>): Promise<boolean> {
  if (!cache.has(table)) {
    const rows = await query<SqlRow>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    cache.set(table, rows.length > 0);
  }
  return cache.get(table) === true;
}

async function setResourceStatus(table: string | undefined, resourceId: string, status: string): Promise<void> {
  if (!table || !(await hasColumn(table, 'approval_status', statusColumns))) {
    return;
  }
  const approved = await hasColumn(table, 'approved', approvedColumns);
  if (approved) {
    await execute(
      `UPDATE \`${table}\` SET approval_status = ?, approved = ?, update_time = ? WHERE id = ?`,
      [status, status === 'APPROVED' ? 1 : 0, Date.now(), resourceId],
    );
    return;
  }
  await execute(`UPDATE \`${table}\` SET approval_status = ?, update_time = ? WHERE id = ?`, [status, Date.now(), resourceId]);
}

export class ApprovalService {
  async page(body: FlowPageQuery, organizationId: string): Promise<Pager<Record<string, unknown>>> {
    const page = normalizePage(body.current, body.pageSize);
    const filters = ['organization_id = ?', 'deleted = 0'];
    const params: unknown[] = [organizationId];
    if (body.keyword) {
      filters.push('name LIKE ?');
      params.push(`%${body.keyword}%`);
    }
    for (const filter of body.filters ?? []) {
      const values = (Array.isArray(filter.value) ? filter.value : [filter.value]).filter((value) => value !== undefined && value !== null && value !== '');
      if (!values.length) {
        continue;
      }
      if (filter.name === 'formType') {
        filters.push(`form_type IN (${values.map(() => '?').join(', ')})`);
        params.push(...values.map((value) => String(value)));
      }
      if (filter.name === 'enable') {
        filters.push(`enable IN (${values.map(() => '?').join(', ')})`);
        params.push(...values.map((value) => (value === true || value === 1 || value === 'true' ? 1 : 0)));
      }
    }
    const sortColumns: Record<string, string> = {
      name: 'name',
      enable: 'enable',
      createUser: 'create_user',
      createTime: 'create_time',
      updateUser: 'update_user',
      updateTime: 'update_time',
    };
    const sortColumn = sortColumns[body.sort?.name ?? ''] ?? 'create_time';
    const direction = body.sort?.name && body.sort.type === 'asc' ? 'ASC' : 'DESC';
    const where = filters.join(' AND ');
    const total = await query<SqlRow & { total: number }>(`SELECT COUNT(*) AS total FROM approval_flow WHERE ${where}`, params);
    const rows = await query<FlowRow>(
      `SELECT * FROM approval_flow WHERE ${where} ORDER BY ${sortColumn} ${direction} LIMIT ? OFFSET ?`,
      [...params, page.pageSize, (page.current - 1) * page.pageSize],
    );
    const names = await userNames(rows.flatMap((row) => [row.create_user, row.update_user]));
    return toPager(rows.map((row) => toListItem(row, names)), Number(total[0]?.total ?? 0), page);
  }

  async add(input: FlowInput, organizationId: string, userId: string): Promise<Record<string, unknown>> {
    const name = text(input.name);
    const formType = text(input.formType);
    if (!name || !formType) {
      throw validateFailed('流程名称和表单类型不能为空');
    }
    const id = nextId();
    const versionId = nextId();
    const now = Date.now();
    const number = await nextNumber(formType, organizationId);
    await withTransaction(async (tx) => {
      await tx.execute(
        'INSERT INTO approval_flow_version (id, flow_id, create_time, create_user, organization_id) VALUES (?, ?, ?, ?, ?)',
        [versionId, id, now, userId, organizationId],
      );
      await tx.execute(
        `INSERT INTO approval_flow
          (id, current_version_id, number, name, form_type, create_execute, update_execute, delete_execute,
           submitter_can_revoke, allow_batch_process, allow_withdraw, allow_add_sign, duplicate_approver_rule,
           require_comment, enable, deleted, create_time, update_time, create_user, update_user, organization_id,
           status_permissions, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, versionId, number, name, formType,
          flag(input.createExecute, true), flag(input.updateExecute, true), flag(input.deleteExecute, false),
          flag(input.submitterCanRevoke, true), flag(input.allowBatchProcess, false), flag(input.allowWithdraw, false),
          flag(input.allowAddSign, false), text(input.duplicateApproverRule, 'FIRST_ONLY') || 'FIRST_ONLY',
          flag(input.requireComment, false), flag(input.enable, true), now, now, userId, userId, organizationId,
          JSON.stringify(input.statusPermissions ?? []), text(input.description) || null,
        ],
      );
      if (flag(input.createExecute, true)) {
        await saveGraph(tx, versionId, 'CREATE', input.createNodeConfig);
      }
      if (flag(input.updateExecute, true)) {
        await saveGraph(tx, versionId, 'UPDATE', input.updateNodeConfig);
      }
      if (flag(input.deleteExecute, false)) {
        await saveGraph(tx, versionId, 'DELETE', input.deleteNodeConfig);
      }
    });
    if (flag(input.enable, true)) {
      await disableOtherEnabled(formType, organizationId, id, userId);
    }
    return this.detail(id, organizationId);
  }

  async update(input: FlowInput, organizationId: string, userId: string): Promise<Record<string, unknown>> {
    const id = text(input.id);
    const current = await requireFlow(id, organizationId);
    const name = text(input.name) || current.name;
    const formType = text(input.formType) || current.form_type;
    const hasNodes = Boolean(input.createNodeConfig?.nodes?.length || input.updateNodeConfig?.nodes?.length || input.deleteNodeConfig?.nodes?.length);
    const versionId = hasNodes ? nextId() : current.current_version_id;
    const now = Date.now();
    await withTransaction(async (tx) => {
      if (hasNodes) {
        await tx.execute(
          'INSERT INTO approval_flow_version (id, flow_id, create_time, create_user, organization_id) VALUES (?, ?, ?, ?, ?)',
          [versionId, id, now, userId, organizationId],
        );
        await saveGraph(tx, versionId, 'CREATE', input.createNodeConfig);
        await saveGraph(tx, versionId, 'UPDATE', input.updateNodeConfig);
        await saveGraph(tx, versionId, 'DELETE', input.deleteNodeConfig);
      }
      await tx.execute(
        `UPDATE approval_flow
         SET current_version_id = ?, name = ?, form_type = ?, create_execute = ?, update_execute = ?, delete_execute = ?,
             submitter_can_revoke = ?, allow_batch_process = ?, allow_withdraw = ?, allow_add_sign = ?,
             duplicate_approver_rule = ?, require_comment = ?, enable = ?, status_permissions = ?, description = ?,
             update_time = ?, update_user = ?
         WHERE id = ? AND organization_id = ?`,
        [
          versionId, name, formType,
          flag(input.createExecute, bool(current.create_execute)),
          flag(input.updateExecute, bool(current.update_execute)),
          flag(input.deleteExecute, bool(current.delete_execute)),
          flag(input.submitterCanRevoke, bool(current.submitter_can_revoke)),
          flag(input.allowBatchProcess, bool(current.allow_batch_process)),
          flag(input.allowWithdraw, bool(current.allow_withdraw)),
          flag(input.allowAddSign, bool(current.allow_add_sign)),
          text(input.duplicateApproverRule, current.duplicate_approver_rule) || current.duplicate_approver_rule,
          flag(input.requireComment, bool(current.require_comment)),
          flag(input.enable, bool(current.enable)),
          JSON.stringify(input.statusPermissions ?? parseJson(current.status_permissions, [])),
          input.description === undefined ? current.description : (text(input.description) || null),
          now, userId, id, organizationId,
        ],
      );
    });
    if (flag(input.enable, bool(current.enable))) {
      await disableOtherEnabled(formType, organizationId, id, userId);
    }
    return this.detail(id, organizationId);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await requireFlow(id, organizationId);
    await execute('UPDATE approval_flow SET deleted = 1, update_time = ? WHERE id = ? AND organization_id = ?', [Date.now(), id, organizationId]);
  }

  async enable(id: string, enable: boolean, organizationId: string, userId: string): Promise<void> {
    const current = await requireFlow(id, organizationId);
    if (enable) {
      await disableOtherEnabled(current.form_type, organizationId, id, userId);
    }
    await execute(
      'UPDATE approval_flow SET enable = ?, update_time = ?, update_user = ? WHERE id = ? AND organization_id = ?',
      [enable ? 1 : 0, Date.now(), userId, id, organizationId],
    );
  }

  async detail(id: string, organizationId: string): Promise<Record<string, unknown>> {
    const row = await requireFlow(id, organizationId);
    const names = await userNames([row.create_user, row.update_user]);
    const graph = await loadGraph(row.current_version_id);
    return {
      ...toListItem(row, names),
      permissions: formPermissions(row.form_type),
      createNodeConfig: graph.CREATE,
      updateNodeConfig: graph.UPDATE,
      deleteNodeConfig: graph.DELETE,
      optionMap: {},
    };
  }

  async byFormType(formType: string, organizationId: string): Promise<Record<string, unknown> | null> {
    const rows = await query<FlowRow>(
      'SELECT * FROM approval_flow WHERE organization_id = ? AND form_type = ? AND deleted = 0 AND enable = 1 ORDER BY update_time DESC LIMIT 1',
      [organizationId, formType],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    const names = await userNames([row.create_user, row.update_user]);
    return { ...toListItem(row, names), permissions: formPermissions(row.form_type) };
  }

  async statusPermission(formType: string, organizationId: string): Promise<Record<string, unknown>> {
    const permissions = formPermissions(formType);
    const rows = await query<FlowRow>(
      'SELECT status_permissions FROM approval_flow WHERE organization_id = ? AND form_type = ? AND deleted = 0 AND enable = 1 LIMIT 1',
      [organizationId, formType],
    );
    return {
      permissions,
      statusPermissions: parseJson(rows[0]?.status_permissions, []),
    };
  }

  async formOptions(organizationId: string): Promise<{ id: string; name: string }[]> {
    const rows = await query<SqlRow & { form_type: string }>(
      'SELECT DISTINCT form_type FROM approval_flow WHERE organization_id = ? AND deleted = 0',
      [organizationId],
    );
    return rows.map((row) => ({ id: row.form_type, name: FORMS[row.form_type]?.name ?? row.form_type }));
  }

  async testWebhook(url: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw validateFailed('地址格式不正确');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw validateFailed('地址格式不正确');
    }
    await assertPublicHost(parsed.hostname);
    const resolved = await lookup(parsed.hostname);
    if (isBlockedAddress(resolved.address)) {
      throw validateFailed('不允许使用内网或保留地址');
    }
    try {
      await fetch(parsed, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    } catch (error) {
      if (error instanceof Error && error.name === 'AppError') {
        throw error;
      }
      throw failed('连接失败');
    }
  }

  async todoPage(
    kind: 'pending' | 'processed' | 'initiated' | 'cc',
    body: { current?: number; pageSize?: number; resourceType?: string; resourceName?: string },
    userId: string,
    organizationId: string,
  ): Promise<Pager<Record<string, unknown>>> {
    const page = normalizePage(body.current, body.pageSize);
    const filters = ['f.organization_id = ?', 'f.deleted = 0'];
    const params: unknown[] = [organizationId];
    if (kind === 'initiated') {
      filters.push('i.submitter_id = ?');
      params.push(userId);
    } else if (kind === 'cc') {
      filters.push("t.approver_id = ? AND t.type = 'CC'");
      params.push(userId);
    } else if (kind === 'processed') {
      filters.push("t.approver_id = ? AND t.status IN ('APPROVED', 'UNAPPROVED')");
      params.push(userId);
    } else {
      filters.push("t.approver_id = ? AND t.status IN ('PENDING', 'APPROVING') AND (t.type IS NULL OR t.type <> 'CC')");
      params.push(userId);
    }
    const resourceType = text(body.resourceType);
    if (resourceType && resourceType !== 'ALL') {
      filters.push('i.type = ?');
      params.push(resourceType);
    }
    const where = filters.join(' AND ');
    const from = kind === 'initiated'
      ? `FROM approval_instance i
         JOIN approval_flow_version v ON v.id = i.flow_version_id
         JOIN approval_flow f ON f.id = v.flow_id
         LEFT JOIN approval_task t ON t.instance_id = i.id AND t.id = (
           SELECT id FROM approval_task WHERE instance_id = i.id ORDER BY create_time DESC LIMIT 1
         )`
      : `FROM approval_task t
         JOIN approval_instance i ON i.id = t.instance_id
         JOIN approval_flow_version v ON v.id = i.flow_version_id
         JOIN approval_flow f ON f.id = v.flow_id`;
    const total = await query<SqlRow & { total: number }>(`SELECT COUNT(*) AS total ${from} WHERE ${where}`, params);
    const rows = await query<SqlRow>(
      `SELECT t.id AS task_id, t.node_id, t.approver_id, t.status AS task_status, t.action, t.type AS task_type,
              i.id AS instance_id, i.resource_id, i.type AS resource_type, i.submitter_id, i.submit_time,
              i.approval_status, i.execute_time, i.flow_version_id, f.id AS flow_id
       ${from}
       WHERE ${where}
       ORDER BY i.submit_time DESC
       LIMIT ? OFFSET ?`,
      [...params, page.pageSize, (page.current - 1) * page.pageSize],
    );
    const names = await userNames(rows.map((row) => String(row.submitter_id ?? '')));
    const list = [];
    for (const row of rows) {
      const resourceName = await resourceNameOf(String(row.resource_type ?? ''), String(row.resource_id ?? ''));
      if (body.resourceName && !resourceName.includes(body.resourceName)) {
        continue;
      }
      list.push({
        approvalTaskId: row.task_id ?? '',
        approvalNodeId: row.node_id ?? '',
        approvalInstanceId: row.instance_id,
        approvalId: row.approver_id ?? '',
        approvalFlowId: row.flow_id,
        approvalFlowVersionId: row.flow_version_id,
        resourceId: row.resource_id,
        resourceName,
        resourceType: row.resource_type,
        resourceNotFound: !resourceName,
        applicant: names.get(String(row.submitter_id)) ?? String(row.submitter_id ?? ''),
        submitTime: Number(row.submit_time ?? 0),
        approvalOperation: row.action ?? '',
        dataResult: row.approval_status,
        executeTime: row.execute_time ?? 'CREATE',
      });
    }
    return toPager(list, Number(total[0]?.total ?? 0), page);
  }

  async pendingCount(userId: string, organizationId: string, cc: boolean): Promise<Record<string, number>> {
    const options = await this.formOptions(organizationId);
    const rows = await query<SqlRow & { resource_type: string; total: number }>(
      `SELECT i.type AS resource_type, COUNT(*) AS total
       FROM approval_task t
       JOIN approval_instance i ON i.id = t.instance_id
       JOIN approval_flow_version v ON v.id = i.flow_version_id
       JOIN approval_flow f ON f.id = v.flow_id
       WHERE f.organization_id = ? AND t.approver_id = ?
         AND ${cc ? "t.type = 'CC'" : "t.status IN ('PENDING', 'APPROVING') AND (t.type IS NULL OR t.type <> 'CC')"}
       GROUP BY i.type`,
      [organizationId, userId],
    );
    const result: Record<string, number> = {};
    for (const option of options) {
      result[option.id] = 0;
    }
    for (const row of rows) {
      result[row.resource_type] = Number(row.total);
    }
    result.total = rows.reduce((sum, row) => sum + Number(row.total), 0);
    return result;
  }

  formKeyByTable(table: string): string | undefined {
    return Object.entries(FORMS).find(([, form]) => form.table === table)?.[0];
  }

  async afterCreate(formKey: string, resourceId: string, organizationId: string): Promise<void> {
    const flow = await this.enabledFlow(formKey, organizationId);
    if (!flow || !bool(flow.create_execute)) {
      return;
    }
    await setResourceStatus(FORMS[formKey]?.table, resourceId, 'PENDING');
  }

  async guardAction(formKey: string, organizationId: string, approvalStatus: string, action: string): Promise<void> {
    const flow = await this.enabledFlow(formKey, organizationId);
    if (!flow || !approvalStatus) {
      return;
    }
    const items = parseJson<Array<{ approvalStatus?: string; permission?: string; enabled?: boolean }>>(flow.status_permissions, []);
    const related = items.filter((item) => item.approvalStatus === approvalStatus && permissionMatches(item.permission, action));
    if (related.length > 0 && related.every((item) => item.enabled === false)) {
      throw validateFailed('当前审批状态下不允许此操作');
    }
  }

  async afterUpdate(formKey: string, resourceId: string, organizationId: string, userId: string, previousStatus: string): Promise<void> {
    const flow = await this.enabledFlow(formKey, organizationId);
    if (!flow || !bool(flow.update_execute) || previousStatus !== 'APPROVED') {
      return;
    }
    await this.push(resourceId, formKey, organizationId, userId, 'UPDATE');
  }

  async interceptDelete(formKey: string, resourceId: string, organizationId: string, userId: string): Promise<boolean> {
    const flow = await this.enabledFlow(formKey, organizationId);
    if (!flow || !bool(flow.delete_execute)) {
      return false;
    }
    await this.push(resourceId, formKey, organizationId, userId, 'DELETE');
    return true;
  }

  async assertBatch(taskId: string): Promise<void> {
    const flow = await flowOfTask(taskId);
    if (flow && !bool(flow.allow_batch_process)) {
      throw validateFailed('当前审批流不允许批量处理');
    }
  }

  async enabledFlow(formKey: string, organizationId: string): Promise<FlowRow | undefined> {
    const rows = await query<FlowRow>(
      'SELECT * FROM approval_flow WHERE organization_id = ? AND form_type = ? AND deleted = 0 AND enable = 1 LIMIT 1',
      [organizationId, formKey],
    );
    return rows[0];
  }

  async push(resourceId: string, formKey: string, organizationId: string, userId: string, executeTime = 'CREATE'): Promise<void> {
    const flow = await this.enabledFlow(formKey, organizationId);
    if (!flow) {
      throw validateFailed('未配置审批流');
    }
    const running = await query<SqlRow>(
      `SELECT id FROM approval_instance WHERE resource_id = ? AND approval_status = 'APPROVING' LIMIT 1`,
      [resourceId],
    );
    if (running.length) {
      throw validateFailed('该单据正在审批中');
    }
    const now = Date.now();
    const instanceId = nextId();
    await execute(
      `INSERT INTO approval_instance
        (id, flow_version_id, type, resource_id, submitter_id, current_node_id, approval_status, submit_time,
         approval_time, create_time, update_time, create_user, update_user, execute_time)
       VALUES (?, ?, ?, ?, ?, NULL, 'APPROVING', ?, NULL, ?, ?, ?, ?, ?)`,
      [instanceId, flow.current_version_id, formKey, resourceId, userId, now, now, now, userId, userId, executeTime],
    );
    await driveInstance(instanceId, flow, null, organizationId, userId);
  }

  async revokeResource(resourceId: string, userId: string): Promise<void> {
    const rows = await query<SqlRow & { id: string; type: string; submitter_id: string }>(
      `SELECT id, type, submitter_id FROM approval_instance WHERE resource_id = ? AND approval_status = 'APPROVING' ORDER BY create_time DESC LIMIT 1`,
      [resourceId],
    );
    const instance = rows[0];
    if (!instance) {
      throw validateFailed('没有审批中的申请');
    }
    const flow = await flowOfInstance(instance.id);
    if (flow && !bool(flow.submitter_can_revoke)) {
      throw validateFailed('当前审批流不允许撤回');
    }
    if (instance.submitter_id !== userId && userId !== ADMIN_USER_ID) {
      throw validateFailed('只能由提交人撤回');
    }
    const now = Date.now();
    await execute(
      `UPDATE approval_instance SET approval_status = 'REVOKED', update_time = ?, update_user = ? WHERE id = ?`,
      [now, userId, instance.id],
    );
    await execute(
      `UPDATE approval_task SET status = 'REVOKED', update_time = ?, update_user = ? WHERE instance_id = ? AND status IN ('PENDING', 'APPROVING')`,
      [now, userId, instance.id],
    );
    await setResourceStatus(FORMS[instance.type]?.table, resourceId, 'REVOKED');
  }

  async simpleDetail(resourceId: string): Promise<Record<string, unknown>> {
    const instances = await query<SqlRow & { id: string; approval_status: string }>(
      'SELECT id, approval_status FROM approval_instance WHERE resource_id = ? ORDER BY create_time DESC LIMIT 1',
      [resourceId],
    );
    const instance = instances[0];
    if (!instance) {
      return { resourceId, approveStatus: '', approveUserList: [] };
    }
    const tasks = await query<SqlRow & { approver_id: string; status: string; action: string | null }>(
      'SELECT approver_id, status, action FROM approval_task WHERE instance_id = ? ORDER BY create_time',
      [instance.id],
    );
    const names = await userNames(tasks.map((task) => task.approver_id));
    return {
      resourceId,
      approveStatus: instance.approval_status,
      approveUserList: tasks.map((task) => ({
        id: task.approver_id,
        name: names.get(task.approver_id) ?? task.approver_id,
        avatar: '',
        approveResult: task.status,
        approveReason: task.action ?? '',
      })),
    };
  }

  async instanceDetail(resourceId: string): Promise<Record<string, unknown>> {
    const instances = await query<SqlRow>(
      'SELECT * FROM approval_instance WHERE resource_id = ? ORDER BY create_time DESC LIMIT 1',
      [resourceId],
    );
    const instance = instances[0];
    if (!instance) {
      return {
        id: '',
        submitterId: '',
        submitAvatar: '',
        submitter: '',
        submitTime: 0,
        comment: '',
        approvalStatus: '',
        currentNodeId: '',
        executeTime: 'CREATE',
        nodes: [],
        currentNodeFieldPermissions: '',
      };
    }
    const names = await userNames([String(instance.submitter_id)]);
    const tasks = await query<SqlRow>(
      `SELECT t.id AS task_id, t.node_id, t.approver_id, t.status, n.name AS node_name
       FROM approval_task t
       LEFT JOIN approval_node n ON n.id = t.node_id
       WHERE t.instance_id = ?
       ORDER BY t.create_time`,
      [instance.id],
    );
    const taskNames = await userNames(tasks.map((task) => String(task.approver_id)));
    return {
      id: instance.id,
      submitterId: instance.submitter_id,
      submitAvatar: '',
      submitter: names.get(String(instance.submitter_id)) ?? String(instance.submitter_id),
      submitTime: Number(instance.submit_time ?? 0),
      comment: instance.comment ?? '',
      approvalStatus: instance.approval_status,
      currentNodeId: instance.current_node_id ?? '',
      executeTime: instance.execute_time ?? 'CREATE',
      currentNodeFieldPermissions: '',
      nodes: tasks.map((task) => ({
        taskId: task.task_id,
        recordId: '',
        nodeId: task.node_id,
        nodeName: task.node_name ?? '',
        endNode: false,
        approverId: task.approver_id,
        approverName: taskNames.get(String(task.approver_id)) ?? String(task.approver_id),
        approveResult: task.status,
      })),
    };
  }

  async act(action: 'APPROVE' | 'REJECT', taskId: string, comment: string, userId: string): Promise<void> {
    const tasks = await query<SqlRow & { id: string; instance_id: string; node_id: string; status: string }>(
      'SELECT id, instance_id, node_id, status FROM approval_task WHERE id = ?',
      [taskId],
    );
    const task = tasks[0];
    if (!task || (task.status !== 'PENDING' && task.status !== 'APPROVING')) {
      throw validateFailed('审批任务不存在或已处理');
    }
    const flow = await flowOfInstance(task.instance_id);
    if (flow && bool(flow.require_comment) && !comment.trim()) {
      throw validateFailed('请填写审批意见');
    }
    const now = Date.now();
    const status = action === 'APPROVE' ? 'APPROVED' : 'UNAPPROVED';
    await execute(
      'UPDATE approval_task SET status = ?, action = ?, update_time = ?, update_user = ? WHERE id = ?',
      [status, action, now, userId, task.id],
    );
    await execute(
      `INSERT INTO approval_record
        (id, instance_id, task_id, node_id, node_round, result, comment, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [nextId(), task.instance_id, task.id, task.node_id, status, comment || null, now, now, userId, userId],
    );
    if (action === 'REJECT') {
      await execute(
        `UPDATE approval_task SET status = 'UNAPPROVED', update_time = ?, update_user = ?
         WHERE instance_id = ? AND id <> ? AND status IN ('PENDING', 'APPROVING', 'WAITING')`,
        [now, userId, task.instance_id, task.id],
      );
      await finishInstance(task.instance_id, 'UNAPPROVED', userId);
      return;
    }
    const modeRows = await query<SqlRow & { multi_approver_mode: string | null }>(
      'SELECT multi_approver_mode FROM approval_node_approver WHERE id = ?',
      [task.node_id],
    );
    const mode = modeRows[0]?.multi_approver_mode || 'ALL';
    if (mode === 'ANY') {
      await execute(
        `UPDATE approval_task SET status = 'SKIPPED', update_time = ?, update_user = ?
         WHERE instance_id = ? AND node_id = ? AND id <> ? AND status IN ('PENDING', 'APPROVING', 'WAITING') AND (type IS NULL OR type <> 'CC')`,
        [now, userId, task.instance_id, task.node_id, task.id],
      );
    }
    if (mode === 'SEQUENTIAL') {
      const waiting = await query<SqlRow & { id: string }>(
        `SELECT id FROM approval_task
         WHERE instance_id = ? AND node_id = ? AND status = 'WAITING' AND (type IS NULL OR type <> 'CC')
         ORDER BY create_time LIMIT 1`,
        [task.instance_id, task.node_id],
      );
      if (waiting[0]) {
        await execute(
          `UPDATE approval_task SET status = 'PENDING', update_time = ?, update_user = ? WHERE id = ?`,
          [now, userId, waiting[0].id],
        );
        return;
      }
    }
    const left = await query<SqlRow & { total: number }>(
      `SELECT COUNT(*) AS total FROM approval_task
       WHERE instance_id = ? AND status IN ('PENDING', 'APPROVING') AND (type IS NULL OR type <> 'CC')`,
      [task.instance_id],
    );
    if (Number(left[0]?.total ?? 0) === 0 && flow) {
      const organizationId = flow.organization_id;
      await driveInstance(task.instance_id, flow, task.node_id, organizationId, userId);
    }
  }

  async sign(taskId: string, signApprover: string, type: string, comment: string, userId: string): Promise<void> {
    if (!signApprover) {
      throw validateFailed('请选择加签人');
    }
    const tasks = await query<SqlRow & { id: string; instance_id: string; node_id: string }>(
      'SELECT id, instance_id, node_id FROM approval_task WHERE id = ?',
      [taskId],
    );
    const task = tasks[0];
    if (!task) {
      throw validateFailed('审批任务不存在或已处理');
    }
    const flow = await flowOfInstance(task.instance_id);
    if (flow && !bool(flow.allow_add_sign)) {
      throw validateFailed('当前审批流不允许加签');
    }
    const now = Date.now();
    const signTaskId = nextId();
    await execute(
      `INSERT INTO approval_task
        (id, node_id, node_round, instance_id, approver_id, status, type, action, create_time, update_time, create_user, update_user)
       VALUES (?, ?, 1, ?, ?, 'PENDING', 'SN', 'SIGN', ?, ?, ?, ?)`,
      [signTaskId, task.node_id, task.instance_id, signApprover, now, now, userId, userId],
    );
    await execute(
      `INSERT INTO approval_add_sign_task (id, type, task_id, sign_task_id, root_task_id, sort, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nextId(), type || 'before', signTaskId, task.id, task.id, now, comment || null],
    );
  }

  async back(taskId: string, returnToNodeId: string, reason: string, userId: string): Promise<void> {
    const tasks = await query<SqlRow & { id: string; instance_id: string }>(
      'SELECT id, instance_id FROM approval_task WHERE id = ?',
      [taskId],
    );
    const task = tasks[0];
    if (!task || !returnToNodeId) {
      throw validateFailed('退回节点不能为空');
    }
    const flow = await flowOfInstance(task.instance_id);
    if (flow && !bool(flow.allow_withdraw)) {
      throw validateFailed('当前审批流不允许审批人撤回');
    }
    const now = Date.now();
    await execute(
      `INSERT INTO approval_return_back_record (id, instance_id, task_id, return_to_node_id, return_reason, return_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nextId(), task.instance_id, task.id, returnToNodeId, reason || null, userId],
    );
    await execute(
      `UPDATE approval_task SET action = 'BACK', update_time = ?, update_user = ? WHERE id = ?`,
      [now, userId, task.id],
    );
    await execute(
      'UPDATE approval_instance SET current_node_id = ?, update_time = ?, update_user = ? WHERE id = ?',
      [returnToNodeId, now, userId, task.instance_id],
    );
  }
}

async function finishInstance(instanceId: string, status: string, userId: string): Promise<void> {
  const now = Date.now();
  await execute(
    'UPDATE approval_instance SET approval_status = ?, approval_time = ?, update_time = ?, update_user = ? WHERE id = ?',
    [status, now, now, userId, instanceId],
  );
  const rows = await query<SqlRow & { resource_id: string; type: string; execute_time: string | null }>(
    'SELECT resource_id, type, execute_time FROM approval_instance WHERE id = ?',
    [instanceId],
  );
  const instance = rows[0];
  if (!instance) {
    return;
  }
  if (status === 'APPROVED' && instance.execute_time === 'DELETE') {
    await removeApprovedResource(instance.type, instance.resource_id);
    return;
  }
  await setResourceStatus(FORMS[instance.type]?.table, instance.resource_id, status);
}

async function removeApprovedResource(formKey: string, resourceId: string): Promise<void> {
  const form = FORMS[formKey];
  if (!form) {
    return;
  }
  const rows = await query<SqlRow & { organization_id: string }>(
    `SELECT organization_id FROM \`${form.table}\` WHERE id = ?`,
    [resourceId],
  );
  const organizationId = rows[0]?.organization_id;
  if (!organizationId) {
    return;
  }
  await deleteModuleFields(form.fieldTable, form.blobTable, [resourceId]);
  await deleteRecords(form.table, [resourceId], organizationId);
}

function permissionMatches(permission: string | undefined, action: string): boolean {
  if (!permission) {
    return false;
  }
  return permission === action || permission.endsWith(`:${action}`);
}

async function flowOfInstance(instanceId: string): Promise<FlowRow | undefined> {
  const rows = await query<FlowRow>(
    `SELECT f.* FROM approval_instance i
     JOIN approval_flow_version v ON v.id = i.flow_version_id
     JOIN approval_flow f ON f.id = v.flow_id
     WHERE i.id = ? LIMIT 1`,
    [instanceId],
  );
  return rows[0];
}

async function flowOfTask(taskId: string): Promise<FlowRow | undefined> {
  const rows = await query<SqlRow & { instance_id: string }>(
    'SELECT instance_id FROM approval_task WHERE id = ?',
    [taskId],
  );
  const instanceId = rows[0]?.instance_id;
  return instanceId ? flowOfInstance(instanceId) : undefined;
}

interface RuntimeNode {
  id: string;
  nodeType: string;
  sort: number;
  approver?: SqlRow;
}

interface RuntimeGraph {
  nodes: Map<string, RuntimeNode>;
  links: Array<{ from: string; to: string }>;
}

async function loadRuntime(versionId: string, executeTime: string): Promise<RuntimeGraph> {
  const nodes = await query<SqlRow & { id: string; node_type: string; sort: number }>(
    'SELECT id, node_type, sort FROM approval_node WHERE flow_version_id = ? AND execute_time = ? ORDER BY sort',
    [versionId, executeTime],
  );
  const approvers = await query<SqlRow>('SELECT * FROM approval_node_approver WHERE flow_version_id = ?', [versionId]);
  const links = await query<SqlRow & { from_node_id: string; to_node_id: string }>(
    'SELECT from_node_id, to_node_id FROM approval_node_link WHERE flow_version_id = ? ORDER BY sort',
    [versionId],
  );
  const approverById = new Map(approvers.map((row) => [String(row.id), row]));
  const map = new Map<string, RuntimeNode>();
  for (const node of nodes) {
    map.set(node.id, {
      id: node.id,
      nodeType: node.node_type,
      sort: Number(node.sort),
      approver: approverById.get(node.id),
    });
  }
  const nodeIds = new Set(map.keys());
  return {
    nodes: map,
    links: links
      .filter((link) => nodeIds.has(link.from_node_id) && nodeIds.has(link.to_node_id))
      .map((link) => ({ from: link.from_node_id, to: link.to_node_id })),
  };
}

function nextStop(graph: RuntimeGraph, fromId: string | null): RuntimeNode | 'END' {
  const queue: string[] = [];
  if (fromId) {
    queue.push(...graph.links.filter((link) => link.from === fromId).map((link) => link.to));
    if (!queue.length) {
      const current = graph.nodes.get(fromId);
      const next = [...graph.nodes.values()]
        .filter((node) => node.nodeType === 'APPROVER' && (current ? node.sort > current.sort : true))
        .sort((left, right) => left.sort - right.sort)[0];
      return next ?? 'END';
    }
  } else {
    const starts = [...graph.nodes.values()].filter((node) => node.nodeType === 'START').sort((left, right) => left.sort - right.sort);
    if (starts.length) {
      queue.push(...starts.map((node) => node.id));
    } else {
      const first = [...graph.nodes.values()].filter((node) => node.nodeType === 'APPROVER').sort((left, right) => left.sort - right.sort)[0];
      return first ?? 'END';
    }
  }
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const node = graph.nodes.get(id);
    if (!node) {
      continue;
    }
    if (node.nodeType === 'APPROVER') {
      return node;
    }
    if (node.nodeType === 'END' && queue.length === 0) {
      return 'END';
    }
    queue.push(...graph.links.filter((link) => link.from === id).map((link) => link.to));
  }
  return 'END';
}

async function driveInstance(instanceId: string, flow: FlowRow, fromNodeId: string | null, organizationId: string, userId: string): Promise<void> {
  const instances = await query<SqlRow & { submitter_id: string; type: string; resource_id: string; execute_time: string | null }>(
    'SELECT submitter_id, type, resource_id, execute_time FROM approval_instance WHERE id = ?',
    [instanceId],
  );
  const instance = instances[0];
  if (!instance) {
    return;
  }
  const graph = await loadRuntime(flow.current_version_id, instance.execute_time || 'CREATE');
  const seen = new Set<string>();
  let cursor = fromNodeId;
  let previousApprover: string | null = null;
  if (fromNodeId) {
    const last = await query<SqlRow & { approver_id: string }>(
      `SELECT approver_id FROM approval_task
       WHERE instance_id = ? AND node_id = ? AND status = 'APPROVED' AND (type IS NULL OR type <> 'CC')
       ORDER BY update_time DESC LIMIT 1`,
      [instanceId, fromNodeId],
    );
    previousApprover = last[0]?.approver_id ?? null;
  }
  while (seen.size < 30) {
    const step = nextStop(graph, cursor);
    if (step === 'END') {
      await finishInstance(instanceId, 'APPROVED', userId);
      return;
    }
    if (seen.has(step.id)) {
      await finishInstance(instanceId, 'APPROVED', userId);
      return;
    }
    seen.add(step.id);
    await execute(
      'UPDATE approval_instance SET current_node_id = ?, update_time = ?, update_user = ? WHERE id = ?',
      [step.id, Date.now(), userId, instanceId],
    );
    const decision = await assignNode(instanceId, step, instance.submitter_id, organizationId, flow.duplicate_approver_rule, previousApprover, userId);
    if (decision === 'REJECT') {
      await finishInstance(instanceId, 'UNAPPROVED', userId);
      return;
    }
    if (decision === 'WAIT') {
      await setResourceStatus(FORMS[instance.type]?.table, instance.resource_id, 'APPROVING');
      return;
    }
    cursor = step.id;
    previousApprover = null;
  }
  await finishInstance(instanceId, 'APPROVED', userId);
}

async function assignNode(
  instanceId: string,
  node: RuntimeNode,
  submitterId: string,
  organizationId: string,
  duplicateRule: string,
  previousApprover: string | null,
  userId: string,
): Promise<'WAIT' | 'PASS' | 'REJECT'> {
  const approver = node.approver;
  if (!approver || approver.approval_type === 'AUTO_PASS') {
    return 'PASS';
  }
  if (approver.approval_type === 'AUTO_REJECT') {
    return 'REJECT';
  }
  let ids = await resolveApproverIds(String(approver.approver_type || 'MEMBER'), parseJson(approver.approver_list == null ? null : String(approver.approver_list), []), submitterId, organizationId);
  ids = await applySameSubmitter(ids, submitterId, String(approver.same_submitter_action || 'SKIP'), organizationId);
  ids = await applyDuplicate(ids, instanceId, duplicateRule, previousApprover);
  if (!ids.length) {
    const emptyAction = String(approver.empty_approver_action || 'AUTO_PASS');
    if (emptyAction === 'ASSIGN_SPECIFIC' && approver.fallback_approver) {
      ids = [String(approver.fallback_approver)];
    } else if (emptyAction === 'ASSIGN_ADMIN') {
      ids = [ADMIN_USER_ID];
    } else {
      return 'PASS';
    }
  }
  const now = Date.now();
  const mode = String(approver.multi_approver_mode || 'ALL');
  for (let index = 0; index < ids.length; index += 1) {
    await execute(
      `INSERT INTO approval_task
        (id, node_id, node_round, instance_id, approver_id, status, type, create_time, update_time, create_user, update_user)
       VALUES (?, ?, 1, ?, ?, ?, 'NL', ?, ?, ?, ?)`,
      [nextId(), node.id, instanceId, ids[index], mode === 'SEQUENTIAL' && index > 0 ? 'WAITING' : 'PENDING', now, now, userId, userId],
    );
  }
  const ccIds = await resolveApproverIds(
    String(approver.cc_type || 'MEMBER'),
    parseJson(approver.cc_list == null ? null : String(approver.cc_list), []),
    submitterId,
    organizationId,
  );
  for (const ccId of ccIds) {
    await execute(
      `INSERT INTO approval_task
        (id, node_id, node_round, instance_id, approver_id, status, type, create_time, update_time, create_user, update_user)
       VALUES (?, ?, 1, ?, ?, 'PENDING', 'CC', ?, ?, ?, ?)`,
      [nextId(), node.id, instanceId, ccId, now, now, userId, userId],
    );
  }
  return 'WAIT';
}

async function resolveApproverIds(type: string, raw: unknown, submitterId: string, organizationId: string): Promise<string[]> {
  const ids = idList(raw);
  if (type === 'ROLE') {
    return roleMembers(ids, organizationId);
  }
  if (type === 'SUPERIOR') {
    const supervisor = await supervisorOf(submitterId, organizationId);
    return supervisor ? [supervisor] : [];
  }
  if (type === 'MULTIPLE_SUPERIOR') {
    return supervisorChain(submitterId, organizationId, levelCount(ids));
  }
  if (type === 'DEPT_HEAD' || type === 'MULTIPLE_DEPT_HEAD') {
    return departmentHeads(submitterId, organizationId, type === 'DEPT_HEAD' ? 1 : levelCount(ids));
  }
  return ids;
}

function levelCount(ids: string[]): number {
  const level = Number(ids[0] ?? 1);
  if (!Number.isFinite(level) || level < 1) {
    return 1;
  }
  return Math.min(Math.floor(level), 8);
}

async function roleMembers(roleIds: string[], organizationId: string): Promise<string[]> {
  if (!roleIds.length) {
    return [];
  }
  const rows = await query<SqlRow & { user_id: string }>(
    `SELECT DISTINCT sur.user_id
     FROM sys_user_role sur
     INNER JOIN sys_role sr ON sr.id = sur.role_id
     WHERE sr.organization_id = ? AND sur.role_id IN (${roleIds.map(() => '?').join(', ')})`,
    [organizationId, ...roleIds],
  );
  return rows.map((row) => row.user_id);
}

async function supervisorOf(userId: string, organizationId: string): Promise<string | null> {
  const rows = await query<SqlRow & { supervisor_id: string | null }>(
    'SELECT supervisor_id FROM sys_organization_user WHERE user_id = ? AND organization_id = ? LIMIT 1',
    [userId, organizationId],
  );
  return rows[0]?.supervisor_id || null;
}

async function supervisorChain(userId: string, organizationId: string, levels: number): Promise<string[]> {
  const chain: string[] = [];
  let current = userId;
  for (let index = 0; index < levels; index += 1) {
    const supervisor = await supervisorOf(current, organizationId);
    if (!supervisor || chain.includes(supervisor)) {
      break;
    }
    chain.push(supervisor);
    current = supervisor;
  }
  return chain;
}

async function departmentHeads(userId: string, organizationId: string, levels: number): Promise<string[]> {
  const rows = await query<SqlRow & { department_id: string | null }>(
    'SELECT department_id FROM sys_organization_user WHERE user_id = ? AND organization_id = ? LIMIT 1',
    [userId, organizationId],
  );
  let departmentId = rows[0]?.department_id || null;
  const heads: string[] = [];
  for (let index = 0; index < levels && departmentId; index += 1) {
    const commanders = await query<SqlRow & { user_id: string }>(
      'SELECT user_id FROM sys_department_commander WHERE department_id = ?',
      [departmentId],
    );
    for (const commander of commanders) {
      if (!heads.includes(commander.user_id)) {
        heads.push(commander.user_id);
      }
    }
    const parent = await query<SqlRow & { parent_id: string | null }>(
      'SELECT parent_id FROM sys_department WHERE id = ? LIMIT 1',
      [departmentId],
    );
    departmentId = parent[0]?.parent_id || null;
  }
  return heads;
}

async function applySameSubmitter(ids: string[], submitterId: string, action: string, organizationId: string): Promise<string[]> {
  if (!ids.includes(submitterId) || action === 'ALLOW') {
    return ids;
  }
  const rest = ids.filter((id) => id !== submitterId);
  if (action === 'ASSIGN_SUPERIOR') {
    const supervisor = await supervisorOf(submitterId, organizationId);
    return supervisor ? [...rest, supervisor] : rest;
  }
  return rest;
}

async function applyDuplicate(ids: string[], instanceId: string, rule: string, previousApprover: string | null): Promise<string[]> {
  if (rule === 'EACH') {
    return ids;
  }
  if (rule === 'SEQUENTIAL_ALL') {
    return previousApprover ? ids.filter((id) => id !== previousApprover) : ids;
  }
  const approved = await query<SqlRow & { approver_id: string }>(
    `SELECT approver_id FROM approval_task
     WHERE instance_id = ? AND status = 'APPROVED' AND (type IS NULL OR type <> 'CC')`,
    [instanceId],
  );
  const done = new Set(approved.map((row) => row.approver_id));
  return ids.filter((id) => !done.has(id));
}

async function resourceNameOf(formType: string, resourceId: string): Promise<string> {
  const table = FORMS[formType]?.table;
  if (!table || !resourceId) {
    return '';
  }
  const rows = await query<SqlRow & { name: string | null }>(`SELECT name FROM \`${table}\` WHERE id = ?`, [resourceId]);
  return rows[0]?.name ?? '';
}

export const approvalService = new ApprovalService();
