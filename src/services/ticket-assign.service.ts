import {
  enabledDepartmentUsers,
  findEnabledMember,
} from '../models/ticket.model.js';
import {
  findConfig,
  lockConfig,
  lockRoute,
  updateConfigCursor,
  updateRouteCursor,
  type TicketTemplate,
} from '../models/ticket-setting.model.js';
import type { Tx } from '../support/db.js';
import { validateFailed } from '../support/errors.js';

export interface AssignOutcome {
  departmentId: string | null;
  handlerId: string | null;
  recipientId: string | null;
}

/** 只在发布事务里调用。指定处理人时不推进轮询游标。 */
export async function assignOnCreate(
  tx: Tx,
  organizationId: string,
  template: TicketTemplate,
  requestedHandlerId: string,
  operatorId: string,
  now: number,
): Promise<AssignOutcome> {
  if (template.enableHandler) {
    if (!requestedHandlerId) {
      throw validateFailed('请选择处理人');
    }
    const member = await findEnabledMember(organizationId, requestedHandlerId, tx);
    if (!member) {
      throw validateFailed('请选择处理人');
    }
    return {
      departmentId: member.departmentId,
      handlerId: requestedHandlerId,
      recipientId: requestedHandlerId,
    };
  }

  const route = await lockRoute(tx, organizationId, template.id);
  let departmentId = route?.departmentId ?? null;
  let cursor = route?.lastHandlerId ?? null;
  let configId: string | null = null;
  if (!departmentId) {
    const config = await lockConfig(tx, organizationId);
    departmentId = config?.defaultDepartmentId ?? null;
    cursor = config?.lastHandlerId ?? null;
    configId = config?.id ?? null;
  }
  if (!departmentId) {
    throw validateFailed('请先配置默认处理部门');
  }

  const users = await enabledDepartmentUsers(tx, organizationId, departmentId);
  if (users.length === 0) {
    return { departmentId, handlerId: null, recipientId: null };
  }
  const index = cursor ? users.indexOf(cursor) : -1;
  const handlerId = index < 0 || index >= users.length - 1 ? users[0] : users[index + 1];
  if (!handlerId) {
    return { departmentId, handlerId: null, recipientId: null };
  }
  if (route) {
    await updateRouteCursor(tx, route.id, handlerId, operatorId, now);
  } else if (configId) {
    await updateConfigCursor(tx, configId, handlerId, operatorId, now);
  } else {
    const config = await findConfig(organizationId, tx);
    if (!config) {
      throw validateFailed('请先配置默认处理部门');
    }
  }
  return { departmentId, handlerId, recipientId: handlerId };
}
