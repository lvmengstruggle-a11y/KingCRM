import { execute, query, type SqlRow } from '../support/db.js';
import { notFound, validateFailed } from '../support/errors.js';
import { nextId } from '../support/id.js';
import { normalizePage, toPager, type Pager } from '../support/pager.js';
import { buildTree, type Tree } from '../support/tree.js';

type FolderKind = 'dashboard' | 'agent';

interface FolderNode {
  id: string;
  name: string;
  parentId: string;
  organizationId: string;
  type: 'MODULE' | 'DASHBOARD' | 'AGENT';
  myCollect: boolean;
  resourceUrl: string;
  pos: number;
}

export interface FolderItemInput {
  id?: string;
  name?: string;
  moduleId?: string;
  resourceUrl?: string;
  scopeIds?: string[];
  description?: string;
  script?: string;
  type?: string;
  workspaceId?: string;
  applicationId?: string;
}

interface ItemRow extends SqlRow {
  id: string;
  name: string;
  module_id: string;
  organization_id: string;
  pos: number | string;
  scope_id: string;
  description: string | null;
  create_time: number | string;
  update_time: number | string;
  create_user: string;
  update_user: string;
  resource_url?: string | null;
  script?: string | null;
  type?: string | null;
  workspace_id?: string | null;
  application_id?: string | null;
  module_name?: string | null;
}

const SPECS = {
  dashboard: {
    moduleTable: 'dashboard_module',
    itemTable: 'dashboard',
    collectionTable: 'dashboard_collection',
    itemColumn: 'dashboard_id',
    moduleColumn: 'dashboard_module_id',
    nodeType: 'DASHBOARD' as const,
  },
  agent: {
    moduleTable: 'agent_module',
    itemTable: 'agent',
    collectionTable: 'agent_collection',
    itemColumn: 'agent_id',
    moduleColumn: 'agent_module_id',
    nodeType: 'AGENT' as const,
  },
};

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function scopeText(ids: string[] | undefined): string {
  return JSON.stringify(Array.isArray(ids) ? ids : []);
}

function parseScope(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) {
    return new Map();
  }
  const marks = unique.map(() => '?').join(', ');
  const rows = await query<SqlRow & { id: string; name: string }>(
    `SELECT id, name FROM sys_user WHERE id IN (${marks})`,
    unique,
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

function membersOf(scopeId: string, names: Map<string, string>): { id: string; name: string }[] {
  return parseScope(scopeId).map((id) => ({ id, name: names.get(id) ?? id }));
}

export class FolderService {
  constructor(private readonly kind: FolderKind) {}

  private get spec() {
    return SPECS[this.kind];
  }

  async addModule(parentId: string, name: string, organizationId: string, userId: string): Promise<{ id: string }> {
    const folderName = text(name);
    if (!folderName || folderName.length > 255) {
      throw validateFailed('名称长度必须在 1-255 之间');
    }
    const id = nextId();
    const now = Date.now();
    await execute(
      `INSERT INTO ${this.spec.moduleTable}
        (id, organization_id, name, parent_id, pos, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, organizationId, folderName, text(parentId, 'NONE') || 'NONE', now, now, now, userId, userId],
    );
    return { id };
  }

  async renameModule(id: string, name: string, organizationId: string, userId: string): Promise<void> {
    const folderName = text(name);
    if (!folderName) {
      throw validateFailed('名称不能为空');
    }
    await this.requireModule(id, organizationId);
    await execute(
      `UPDATE ${this.spec.moduleTable} SET name = ?, update_time = ?, update_user = ? WHERE id = ? AND organization_id = ?`,
      [folderName, Date.now(), userId, id, organizationId],
    );
  }

  async deleteModules(ids: string[], organizationId: string): Promise<void> {
    if (!ids.length) {
      throw validateFailed('请选择要删除的文件夹');
    }
    const marks = ids.map(() => '?').join(', ');
    const children = await query<SqlRow>(
      `SELECT id FROM ${this.spec.moduleTable} WHERE organization_id = ? AND parent_id IN (${marks}) LIMIT 1`,
      [organizationId, ...ids],
    );
    const items = await query<SqlRow>(
      `SELECT id FROM ${this.spec.itemTable} WHERE organization_id = ? AND ${this.spec.moduleColumn} IN (${marks}) LIMIT 1`,
      [organizationId, ...ids],
    );
    if (children.length || items.length) {
      throw validateFailed('请先删除子级数据');
    }
    await execute(
      `DELETE FROM ${this.spec.moduleTable} WHERE organization_id = ? AND id IN (${marks})`,
      [organizationId, ...ids],
    );
  }

  async tree(organizationId: string, userId: string): Promise<Tree<FolderNode>[]> {
    const nodes = await this.nodes(organizationId, userId);
    return buildTree(nodes);
  }

  async count(organizationId: string, userId: string): Promise<Record<string, number>> {
    const nodes = await this.nodes(organizationId, userId);
    const direct = new Map<string, number>();
    for (const node of nodes) {
      if (node.type !== 'MODULE') {
        direct.set(node.parentId, (direct.get(node.parentId) ?? 0) + 1);
      }
    }
    const tree = buildTree(nodes.filter((node) => node.type === 'MODULE'));
    const result: Record<string, number> = {};
    const walk = (node: Tree<FolderNode>): number => {
      let total = direct.get(node.id) ?? 0;
      for (const child of node.children) {
        total += walk(child);
      }
      result[node.id] = total;
      return total;
    };
    for (const root of tree) {
      walk(root);
    }
    const collected = await query<SqlRow & { total: number }>(
      `SELECT COUNT(*) AS total FROM ${this.spec.collectionTable} WHERE user_id = ?`,
      [userId],
    );
    result.myCollect = Number(collected[0]?.total ?? 0);
    return result;
  }

  async moveModule(dragNodeId: string, dropNodeId: string, dropPosition: number, organizationId: string, userId: string): Promise<void> {
    const drag = await this.requireModule(dragNodeId, organizationId);
    const drop = await this.requireModule(dropNodeId, organizationId);
    const parentId = dropPosition === 0 ? drop.id : drag.parentId;
    await execute(
      `UPDATE ${this.spec.moduleTable}
       SET parent_id = ?, pos = ?, update_time = ?, update_user = ?
       WHERE id = ? AND organization_id = ?`,
      [parentId, Number(drop.pos) + (dropPosition || 1), Date.now(), userId, drag.id, organizationId],
    );
  }

  async addItem(input: FolderItemInput, organizationId: string, userId: string): Promise<{ id: string }> {
    const name = text(input.name);
    const moduleId = text(input.moduleId);
    if (!name || !moduleId) {
      throw validateFailed('名称和所属文件夹不能为空');
    }
    await this.requireModule(moduleId, organizationId);
    const id = nextId();
    const now = Date.now();
    if (this.kind === 'dashboard') {
      const resourceUrl = text(input.resourceUrl);
      if (!resourceUrl) {
        throw validateFailed('仪表板地址不能为空');
      }
      await execute(
        `INSERT INTO dashboard
          (id, name, resource_url, dashboard_module_id, organization_id, pos, scope_id, description,
           create_time, update_time, create_user, update_user)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, resourceUrl, moduleId, organizationId, now, scopeText(input.scopeIds), text(input.description) || null, now, now, userId, userId],
      );
    } else {
      await execute(
        `INSERT INTO agent
          (id, name, agent_module_id, organization_id, pos, scope_id, script, description, type,
           workspace_id, application_id, create_time, update_time, create_user, update_user)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, name, moduleId, organizationId, now, scopeText(input.scopeIds), input.script ?? '',
          text(input.description) || null, text(input.type, 'SCRIPT') || 'SCRIPT',
          text(input.workspaceId) || null, text(input.applicationId) || null, now, now, userId, userId,
        ],
      );
    }
    return { id };
  }

  async updateItem(input: FolderItemInput, organizationId: string, userId: string): Promise<void> {
    const id = text(input.id);
    await this.requireItem(id, organizationId);
    const name = text(input.name);
    const moduleId = text(input.moduleId);
    if (!name || !moduleId) {
      throw validateFailed('名称和所属文件夹不能为空');
    }
    await this.requireModule(moduleId, organizationId);
    const now = Date.now();
    if (this.kind === 'dashboard') {
      await execute(
        `UPDATE dashboard
         SET name = ?, resource_url = ?, dashboard_module_id = ?, scope_id = ?, description = ?, update_time = ?, update_user = ?
         WHERE id = ? AND organization_id = ?`,
        [name, text(input.resourceUrl), moduleId, scopeText(input.scopeIds), text(input.description) || null, now, userId, id, organizationId],
      );
      return;
    }
    await execute(
      `UPDATE agent
       SET name = ?, agent_module_id = ?, scope_id = ?, script = ?, description = ?, type = ?,
           workspace_id = ?, application_id = ?, update_time = ?, update_user = ?
       WHERE id = ? AND organization_id = ?`,
      [
        name, moduleId, scopeText(input.scopeIds), input.script ?? '', text(input.description) || null,
        text(input.type, 'SCRIPT') || 'SCRIPT', text(input.workspaceId) || null, text(input.applicationId) || null,
        now, userId, id, organizationId,
      ],
    );
  }

  async renameItem(id: string, name: string, moduleId: string, organizationId: string, userId: string): Promise<void> {
    const itemName = text(name);
    if (!itemName) {
      throw validateFailed('名称不能为空');
    }
    await this.requireItem(id, organizationId);
    if (moduleId) {
      await this.requireModule(moduleId, organizationId);
    }
    await execute(
      `UPDATE ${this.spec.itemTable}
       SET name = ?, ${moduleId ? `${this.spec.moduleColumn} = ?, ` : ''} update_time = ?, update_user = ?
       WHERE id = ? AND organization_id = ?`,
      moduleId
        ? [itemName, moduleId, Date.now(), userId, id, organizationId]
        : [itemName, Date.now(), userId, id, organizationId],
    );
  }

  async detail(id: string, organizationId: string): Promise<Record<string, unknown>> {
    const row = await this.requireItem(id, organizationId);
    const names = await userNames([...parseScope(row.scope_id), row.create_user, row.update_user]);
    const moduleName = row.module_name ?? '';
    const shared = {
      id: row.id,
      name: row.name,
      scopeId: row.scope_id,
      members: membersOf(row.scope_id, names),
      description: row.description ?? '',
      createUser: row.create_user,
      updateUser: row.update_user,
      createUserName: names.get(row.create_user) ?? row.create_user,
      updateUserName: names.get(row.update_user) ?? row.update_user,
      createTime: Number(row.create_time),
      updateTime: Number(row.update_time),
      organizationId: row.organization_id,
      pos: Number(row.pos),
    };
    if (this.kind === 'dashboard') {
      return {
        ...shared,
        resourceUrl: row.resource_url ?? '',
        dashboardModuleId: row.module_id,
        dashboardModuleName: moduleName,
      };
    }
    return {
      ...shared,
      script: row.script ?? '',
      type: row.type ?? 'SCRIPT',
      workspaceId: row.workspace_id ?? '',
      applicationId: row.application_id ?? '',
      agentModuleId: row.module_id,
      agentModuleName: moduleName,
    };
  }

  async deleteItem(id: string, organizationId: string): Promise<void> {
    await this.requireItem(id, organizationId);
    await execute(`DELETE FROM ${this.spec.collectionTable} WHERE ${this.spec.itemColumn} = ?`, [id]);
    await execute(`DELETE FROM ${this.spec.itemTable} WHERE id = ? AND organization_id = ?`, [id, organizationId]);
  }

  async page(
    body: { current?: number; pageSize?: number; keyword?: string; moduleIds?: string[]; collected?: boolean },
    organizationId: string,
    userId: string,
  ): Promise<Pager<Record<string, unknown>>> {
    const page = normalizePage(body.current, body.pageSize);
    const filters = ['i.organization_id = ?'];
    const params: unknown[] = [organizationId];
    if (body.keyword) {
      filters.push('i.name LIKE ?');
      params.push(`%${body.keyword}%`);
    }
    if (body.moduleIds?.length) {
      filters.push(`i.${this.spec.moduleColumn} IN (${body.moduleIds.map(() => '?').join(', ')})`);
      params.push(...body.moduleIds);
    }
    if (body.collected) {
      filters.push(`EXISTS (SELECT 1 FROM ${this.spec.collectionTable} col WHERE col.${this.spec.itemColumn} = i.id AND col.user_id = ?)`);
      params.push(userId);
    }
    const where = filters.join(' AND ');
    const totalRows = await query<SqlRow & { total: number }>(
      `SELECT COUNT(*) AS total FROM ${this.spec.itemTable} i WHERE ${where}`,
      params,
    );
    const rows = await this.itemRows(
      `SELECT i.*, i.${this.spec.moduleColumn} AS module_id, m.name AS module_name,
              EXISTS (SELECT 1 FROM ${this.spec.collectionTable} col WHERE col.${this.spec.itemColumn} = i.id AND col.user_id = ?) AS collected
       FROM ${this.spec.itemTable} i
       LEFT JOIN ${this.spec.moduleTable} m ON m.id = i.${this.spec.moduleColumn}
       WHERE ${where}
       ORDER BY i.pos DESC, i.create_time DESC
       LIMIT ? OFFSET ?`,
      [userId, ...params, page.pageSize, (page.current - 1) * page.pageSize],
    );
    const names = await userNames(rows.flatMap((row) => [row.create_user, row.update_user, ...parseScope(row.scope_id)]));
    return toPager(rows.map((row) => this.toListItem(row, names)), Number(totalRows[0]?.total ?? 0), page);
  }

  async collect(id: string, organizationId: string, userId: string, enabled: boolean): Promise<void> {
    await this.requireItem(id, organizationId);
    await execute(
      `DELETE FROM ${this.spec.collectionTable} WHERE user_id = ? AND ${this.spec.itemColumn} = ?`,
      [userId, id],
    );
    if (!enabled) {
      return;
    }
    const now = Date.now();
    await execute(
      `INSERT INTO ${this.spec.collectionTable}
        (id, user_id, ${this.spec.itemColumn}, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nextId(), userId, id, now, now, userId, userId],
    );
  }

  async moveItem(moveId: string, targetId: string, moduleId: string, moveMode: string, organizationId: string, userId: string): Promise<void> {
    const target = await this.requireItem(targetId, organizationId);
    await this.requireItem(moveId, organizationId);
    const nextModule = moduleId || target.module_id;
    const pos = Number(target.pos) + (moveMode === 'BEFORE' ? -1 : 1);
    await execute(
      `UPDATE ${this.spec.itemTable}
       SET ${this.spec.moduleColumn} = ?, pos = ?, update_time = ?, update_user = ?
       WHERE id = ? AND organization_id = ?`,
      [nextModule, pos, Date.now(), userId, moveId, organizationId],
    );
  }

  async options(organizationId: string): Promise<{ id: string; name: string }[]> {
    const rows = await query<SqlRow & { id: string; name: string }>(
      `SELECT id, name FROM ${this.spec.itemTable} WHERE organization_id = ? ORDER BY pos DESC`,
      [organizationId],
    );
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  private async nodes(organizationId: string, userId: string): Promise<FolderNode[]> {
    const modules = await query<SqlRow & { id: string; name: string; parent_id: string; organization_id: string; pos: number }>(
      `SELECT id, name, parent_id, organization_id, pos FROM ${this.spec.moduleTable} WHERE organization_id = ? ORDER BY pos`,
      [organizationId],
    );
    const items = await this.itemRows(
      `SELECT i.id, i.name, i.${this.spec.moduleColumn} AS module_id, i.organization_id, i.pos,
              ${this.kind === 'dashboard' ? 'i.resource_url' : "'' AS resource_url"},
              EXISTS (SELECT 1 FROM ${this.spec.collectionTable} col WHERE col.${this.spec.itemColumn} = i.id AND col.user_id = ?) AS collected
       FROM ${this.spec.itemTable} i
       WHERE i.organization_id = ?`,
      [userId, organizationId],
    );
    return [
      ...modules.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parent_id,
        organizationId: row.organization_id,
        type: 'MODULE' as const,
        myCollect: false,
        resourceUrl: '',
        pos: Number(row.pos),
      })),
      ...items.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.module_id,
        organizationId: row.organization_id,
        type: this.spec.nodeType,
        myCollect: Boolean(Number((row as SqlRow).collected)),
        resourceUrl: row.resource_url ?? '',
        pos: Number(row.pos),
      })),
    ];
  }

  private async itemRows(sql: string, params: unknown[]): Promise<ItemRow[]> {
    return query<ItemRow>(sql, params);
  }

  private toListItem(row: ItemRow, names: Map<string, string>): Record<string, unknown> {
    const shared = {
      id: row.id,
      name: row.name,
      organizationId: row.organization_id,
      pos: Number(row.pos),
      scopeId: row.scope_id,
      members: membersOf(row.scope_id, names),
      description: row.description ?? '',
      createUser: row.create_user,
      updateUser: row.update_user,
      createUserName: names.get(row.create_user) ?? row.create_user,
      updateUserName: names.get(row.update_user) ?? row.update_user,
      createTime: Number(row.create_time),
      updateTime: Number(row.update_time),
      myCollect: Boolean(Number((row as SqlRow).collected)),
    };
    if (this.kind === 'dashboard') {
      return {
        ...shared,
        resourceUrl: row.resource_url ?? '',
        dashboardModuleId: row.module_id,
        dashboardModuleName: row.module_name ?? '',
      };
    }
    return {
      ...shared,
      script: row.script ?? '',
      type: row.type ?? 'SCRIPT',
      workspaceId: row.workspace_id ?? '',
      applicationId: row.application_id ?? '',
      agentModuleId: row.module_id,
      agentModuleName: row.module_name ?? '',
    };
  }

  private async requireModule(id: string, organizationId: string): Promise<SqlRow & { id: string; pos: number; parentId: string }> {
    const rows = await query<SqlRow & { id: string; pos: number; parent_id: string }>(
      `SELECT id, pos, parent_id FROM ${this.spec.moduleTable} WHERE id = ? AND organization_id = ?`,
      [id, organizationId],
    );
    const row = rows[0];
    if (!row) {
      throw notFound('文件夹不存在');
    }
    return { ...row, parentId: row.parent_id };
  }

  private async requireItem(id: string, organizationId: string): Promise<ItemRow> {
    const rows = await this.itemRows(
      `SELECT i.*, i.${this.spec.moduleColumn} AS module_id, m.name AS module_name
       FROM ${this.spec.itemTable} i
       LEFT JOIN ${this.spec.moduleTable} m ON m.id = i.${this.spec.moduleColumn}
       WHERE i.id = ? AND i.organization_id = ?`,
      [id, organizationId],
    );
    const row = rows[0];
    if (!row) {
      throw notFound('数据不存在');
    }
    return row;
  }
}

export const dashboardFolder = new FolderService('dashboard');
export const agentFolder = new FolderService('agent');
