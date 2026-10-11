import { insertOperationLog } from '../models/operation-log.model.js';
import { countDepartmentTicketUsage } from '../models/ticket-setting.model.js';
import {
  countDepartmentName,
  countUsersInDepartments,
  deleteDepartments,
  findDepartment,
  insertDepartment,
  listDepartments,
  nextDepartmentPos,
  renameDepartment,
  replaceCommander,
  updateDepartmentPlacement,
  type DepartmentRecord,
} from '../models/department.model.js';
import { findMembership } from '../models/organization.model.js';
import { failed, notFound } from '../support/errors.js';
import { nextId } from '../support/id.js';
import { buildTree, type TreeNode } from '../support/tree.js';
import { withTransaction } from '../support/db.js';

const MODULE = 'SYSTEM_ORGANIZATION';

export class DepartmentService {
  async tree(organizationId: string): Promise<TreeNode[]> {
    const rows = await listDepartments(organizationId);
    return buildTree(rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      organizationId: row.organizationId,
    })));
  }

  async add(input: { name: string; parentId: string; organizationId: string; userId: string }): Promise<DepartmentRecord> {
    const parent = await this.requireInOrg(input.parentId, input.organizationId);
    await this.ensureUniqueName(input.name, parent.id, input.organizationId);
    const id = nextId();
    const pos = await nextDepartmentPos(input.organizationId);
    await insertDepartment({ ...input, id, parentId: parent.id, pos });
    await insertOperationLog({
      organizationId: input.organizationId,
      type: 'ADD',
      module: MODULE,
      resourceId: id,
      resourceName: input.name,
      operator: input.userId,
      path: '/department/add',
      method: 'POST',
    });
    const created = await findDepartment(id);
    if (!created) {
      throw failed('部门创建失败');
    }
    return created;
  }

  async rename(input: { id: string; name: string; organizationId: string; userId: string }): Promise<void> {
    const current = await this.requireInOrg(input.id, input.organizationId);
    if (current.name !== input.name) {
      await this.ensureUniqueName(input.name, current.parentId, input.organizationId, current.id);
    }
    await renameDepartment(current.id, input.name, input.userId);
    await insertOperationLog({
      organizationId: input.organizationId,
      type: 'UPDATE',
      module: MODULE,
      resourceId: current.id,
      resourceName: input.name,
      operator: input.userId,
      path: '/department/rename',
      method: 'POST',
    });
  }

  async setCommander(input: {
    departmentId: string;
    commanderId: string;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const department = await this.requireInOrg(input.departmentId, input.organizationId);
    const membership = await findMembership(input.commanderId, input.organizationId);
    if (!membership || !membership.enable) {
      throw failed('负责人不在当前组织或未启用');
    }
    await withTransaction(async (tx) => {
      await replaceCommander(tx, {
        id: nextId(),
        departmentId: department.id,
        commanderId: input.commanderId,
        userId: input.userId,
      });
      await insertOperationLog({
        organizationId: input.organizationId,
        type: 'UPDATE',
        module: MODULE,
        resourceId: department.id,
        resourceName: department.name,
        operator: input.userId,
        path: '/department/set-commander',
        method: 'POST',
      }, tx);
    });
  }

  async deleteCheck(ids: string[], organizationId: string): Promise<boolean> {
    const departments = await this.requireAllInOrg(ids, organizationId);
    for (const department of departments) {
      if (department.resource === 'INTERNAL' && department.parentId.toUpperCase() === 'NONE') {
        throw failed('不能删除根部门');
      }
    }
    const users = await countUsersInDepartments(ids, organizationId);
    if (users > 0) {
      return false;
    }
    const ticketUse = await countDepartmentTicketUsage(ids, organizationId);
    if (ticketUse > 0) {
      throw failed('请先转移工单和路由');
    }
    return true;
  }

  async remove(ids: string[], organizationId: string, userId: string): Promise<void> {
    const allowed = await this.deleteCheck(ids, organizationId);
    if (!allowed) {
      throw failed('部门下存在员工');
    }
    const departments = await this.requireAllInOrg(ids, organizationId);
    await withTransaction(async (tx) => {
      await deleteDepartments(tx, ids);
      for (const department of departments) {
        await insertOperationLog({
          organizationId,
          type: 'DELETE',
          module: MODULE,
          resourceId: department.id,
          resourceName: department.name,
          operator: userId,
          path: '/department/delete',
          method: 'POST',
        }, tx);
      }
    });
  }

  async sort(input: {
    dragNodeId: string;
    dropNodeId: string;
    dropPosition: number;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const nodes = await listDepartments(input.organizationId);
    const drag = nodes.find((node) => node.id === input.dragNodeId);
    const drop = nodes.find((node) => node.id === input.dropNodeId);
    if (!drag || !drop) {
      throw notFound('部门不存在');
    }
    if (drag.id === drop.id) {
      return;
    }
    if (isUnder(nodes, drop.parentId, drag.id)) {
      throw failed('不能把部门移动到自己的下级');
    }
    if (drag.parentId !== drop.parentId) {
      await this.ensureUniqueName(drag.name, drop.parentId, input.organizationId, drag.id);
    }

    const siblings = nodes
      .filter((node) => node.parentId === drop.parentId && node.id !== drag.id)
      .sort((left, right) => left.pos - right.pos);
    const dropIndex = siblings.findIndex((node) => node.id === drop.id);
    const insertAt = input.dropPosition < 0 ? dropIndex : dropIndex + 1;
    siblings.splice(insertAt, 0, { ...drag, parentId: drop.parentId });

    await withTransaction(async (tx) => {
      for (let index = 0; index < siblings.length; index += 1) {
        const node = siblings[index];
        if (!node) {
          continue;
        }
        await updateDepartmentPlacement(tx, {
          id: node.id,
          parentId: node.id === drag.id ? drop.parentId : node.parentId,
          pos: (index + 1) * 4096,
          userId: input.userId,
        });
      }
      await insertOperationLog({
        organizationId: input.organizationId,
        type: 'UPDATE',
        module: MODULE,
        resourceId: drag.id,
        resourceName: drag.name,
        operator: input.userId,
        path: '/department/sort',
        method: 'POST',
      }, tx);
    });
  }

  private async requireInOrg(id: string, organizationId: string): Promise<DepartmentRecord> {
    const department = await findDepartment(id);
    if (!department || department.organizationId !== organizationId) {
      throw notFound('部门不存在');
    }
    return department;
  }

  private async requireAllInOrg(ids: string[], organizationId: string): Promise<DepartmentRecord[]> {
    const departments = await Promise.all(ids.map((id) => this.requireInOrg(id, organizationId)));
    return departments;
  }

  private async ensureUniqueName(name: string, parentId: string, organizationId: string, excludeId?: string): Promise<void> {
    const total = await countDepartmentName(name, parentId, organizationId, excludeId);
    if (total > 0) {
      throw failed('部门名称已存在');
    }
  }
}

export const departmentService = new DepartmentService();

function isUnder(nodes: DepartmentRecord[], nodeId: string, ancestorId: string): boolean {
  let current = nodeId;
  const seen = new Set<string>();
  while (current && current.toUpperCase() !== 'NONE' && !seen.has(current)) {
    if (current === ancestorId) {
      return true;
    }
    seen.add(current);
    const node = nodes.find((item) => item.id === current);
    if (!node) {
      return false;
    }
    current = node.parentId;
  }
  return false;
}
