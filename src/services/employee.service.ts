import { ADMIN_USER_ID } from '../config/index.js';
import {
  countEmail,
  countOwnedResources,
  countPhone,
  deleteEmployee,
  findEmployee,
  findEmployeeByUser,
  updateUserContact,
  findPhone,
  insertEmployee,
  listDeptUserNodes,
  setEnable,
  updateEmployee,
  updatePassword,
  updateUserName,
  batchEditEmployees,
} from '../models/employee.model.js';
import { replaceUserRoles } from '../models/role-admin.model.js';
import { insertOperationLog } from '../models/operation-log.model.js';
import { listUserRoles } from '../models/role.model.js';
import { findPassword, findUserByKey } from '../models/user.model.js';
import { md5 } from '../support/coding.js';
import { failed, notFound, validateFailed } from '../support/errors.js';
import { nextId } from '../support/id.js';
import { sessionStore } from '../support/session-store.js';
import { translateRoleName } from '../support/permission.js';
import { buildTree } from '../support/tree.js';
import { withTransaction } from '../support/db.js';

const EMAIL = /^[a-zA-Z0-9_+&*-]+(?:\.[a-zA-Z0-9_+&*-]+)*@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,7}$/;

export interface EmployeeInput {
  name: string;
  phone: string;
  email: string;
  gender: boolean;
  departmentId: string;
  employeeId?: string;
  employeeType?: string;
  supervisorId?: string;
  position?: string;
  workCity?: string;
  roleIds?: string[];
  enable?: boolean;
  onboardingDate?: number | null;
}

export class EmployeeService {
  async detail(organizationUserId: string, organizationId: string) {
    const employee = await findEmployee(organizationUserId);
    if (!employee || employee.organizationId !== organizationId) {
      throw notFound('员工不存在');
    }
    const roles = await listUserRoles([employee.userId], organizationId);
    return {
      ...employee,
      roles: roles.map((role) => ({
        id: role.id,
        name: translateRoleName(role.name, role.internal),
        userId: role.userId,
      })),
    };
  }

  async add(input: EmployeeInput, organizationId: string, operatorId: string): Promise<void> {
    this.checkContact(input.phone, input.email);
    if (await countEmail(input.email, '') > 0) {
      throw failed('邮箱已存在');
    }
    if (await countPhone(input.phone, '') > 0) {
      throw failed('手机号已存在');
    }
    const userId = nextId();
    const orgUserId = nextId();
    await withTransaction(async (tx) => {
      await insertEmployee(tx, {
        userId,
        orgUserId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        gender: input.gender,
        password: md5(input.phone.slice(-6)),
        language: 'zh_CN',
        organizationId,
        departmentId: input.departmentId,
        employeeId: input.employeeId ?? '',
        employeeType: input.employeeType ?? '',
        supervisorId: input.supervisorId ?? '',
        position: input.position ?? '',
        workCity: input.workCity ?? '',
        enable: input.enable !== false,
        onboardingDate: input.onboardingDate ?? null,
        operatorId,
      });
      await replaceUserRoles(tx, userId, organizationId, input.roleIds ?? [], operatorId);
      await insertOperationLog({
        organizationId,
        type: 'ADD',
        module: 'SYSTEM_ORGANIZATION',
        resourceId: userId,
        resourceName: input.name,
        operator: operatorId,
        path: '/user/add',
        method: 'POST',
      }, tx);
    });
  }

  async update(id: string, input: EmployeeInput, organizationId: string, operatorId: string): Promise<void> {
    const current = await this.detail(id, organizationId);
    this.checkContact(input.phone, input.email);
    if (await countEmail(input.email, current.userId) > 0) {
      throw failed('邮箱已存在');
    }
    if (await countPhone(input.phone, current.userId) > 0) {
      throw failed('手机号已存在');
    }
    await withTransaction(async (tx) => {
      await updateEmployee(tx, {
        orgUserId: current.id,
        userId: current.userId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        gender: input.gender,
        departmentId: input.departmentId,
        employeeId: input.employeeId ?? '',
        employeeType: input.employeeType ?? '',
        supervisorId: input.supervisorId ?? '',
        position: input.position ?? '',
        workCity: input.workCity ?? '',
        enable: input.enable !== false,
        onboardingDate: input.onboardingDate ?? null,
        operatorId,
      });
      if (input.roleIds) {
        await replaceUserRoles(tx, current.userId, organizationId, input.roleIds, operatorId);
      }
    });
    if (input.enable === false && current.userId !== ADMIN_USER_ID) {
      sessionStore.kick(current.userId);
    }
  }

  async resetPassword(userId: string, organizationId: string, operatorId: string): Promise<void> {
    if (userId === ADMIN_USER_ID) {
      return;
    }
    const user = await findPhone(userId);
    if (!user) {
      throw validateFailed('用户不存在');
    }
    if (!user.phone || user.phone.length < 6) {
      throw validateFailed('用户没有可用手机号，无法重置密码');
    }
    await updatePassword(userId, md5(user.phone.slice(-6)), operatorId);
    sessionStore.kick(userId);
    await insertOperationLog({
      organizationId,
      type: 'UPDATE',
      module: 'SYSTEM_ORGANIZATION',
      resourceId: userId,
      resourceName: user.name,
      operator: operatorId,
      path: '/user/reset-password',
      method: 'GET',
    });
  }

  async batchReset(ids: string[], organizationId: string, operatorId: string): Promise<void> {
    for (const id of ids) {
      const employee = await findEmployee(id);
      if (employee && employee.organizationId === organizationId) {
        await this.resetPassword(employee.userId, organizationId, operatorId);
      }
    }
  }

  async batchEnable(ids: string[], enable: boolean, organizationId: string, operatorId: string): Promise<void> {
    const userIds = await setEnable(ids, enable, operatorId);
    if (!enable) {
      for (const userId of userIds) {
        if (userId !== ADMIN_USER_ID) {
          sessionStore.kick(userId);
        }
      }
    }
    await insertOperationLog({
      organizationId,
      type: 'UPDATE',
      module: 'SYSTEM_ORGANIZATION',
      resourceId: ids[0] ?? organizationId,
      resourceName: enable ? '启用员工' : '禁用员工',
      operator: operatorId,
      path: '/user/batch-enable',
      method: 'POST',
    });
  }

  async rename(userId: string, name: string, operatorId: string): Promise<void> {
    await updateUserName(userId, name, operatorId);
  }

  async deleteCheck(organizationUserId: string, organizationId: string): Promise<boolean> {
    const employee = await this.detail(organizationUserId, organizationId);
    return (await countOwnedResources(employee.userId)) <= 0;
  }

  async remove(organizationUserId: string, organizationId: string, operatorId: string): Promise<void> {
    const employee = await this.detail(organizationUserId, organizationId);
    if (employee.userId === ADMIN_USER_ID) {
      throw failed('不能删除管理员');
    }
    if ((await countOwnedResources(employee.userId)) > 0) {
      throw failed('该员工仍负责客户、线索或商机');
    }
    await withTransaction((tx) => deleteEmployee(tx, employee.id, employee.userId, organizationId));
    sessionStore.kick(employee.userId);
    await insertOperationLog({
      organizationId,
      type: 'DELETE',
      module: 'SYSTEM_ORGANIZATION',
      resourceId: employee.userId,
      resourceName: employee.userName,
      operator: operatorId,
      path: '/user/delete',
      method: 'GET',
    });
  }

  async personal(userId: string, organizationId: string) {
    const employee = await findEmployeeByUser(userId, organizationId);
    if (employee) {
      return employee;
    }
    if (userId !== ADMIN_USER_ID) {
      throw notFound('员工不存在');
    }
    const user = await findUserByKey(userId);
    if (!user) {
      throw notFound('员工不存在');
    }
    return {
      id: user.id,
      userId: user.id,
      organizationId,
      departmentId: '',
      departmentName: '',
      userName: user.name,
      enable: true,
      gender: false,
      phone: user.phone,
      email: user.email,
      supervisorId: '',
      employeeId: '',
      position: '',
      employeeType: '',
      workCity: '',
      onboardingDate: null,
      createTime: user.createTime,
      updateTime: user.updateTime,
      createUser: user.createUser,
      updateUser: user.updateUser,
    };
  }

  async updatePersonal(userId: string, organizationId: string, phone: string, email: string): Promise<void> {
    const employee = await findEmployeeByUser(userId, organizationId);
    if (!employee) {
      if (userId !== ADMIN_USER_ID) {
        throw notFound('员工不存在');
      }
      const user = await findUserByKey(userId);
      if (!user) {
        throw notFound('员工不存在');
      }
      const nextPhone = phone || user.phone || '';
      if (nextPhone && nextPhone.length > 11) {
        throw failed('手机号格式不正确');
      }
      if (!EMAIL.test(email)) {
        throw failed('邮箱格式不正确');
      }
      if (await countEmail(email, userId) > 0) {
        throw failed('邮箱已存在');
      }
      if (nextPhone && await countPhone(nextPhone, userId) > 0) {
        throw failed('手机号已存在');
      }
      await updateUserContact(userId, nextPhone, email, userId);
      return;
    }
    this.checkContact(phone, email);
    if (await countEmail(email, userId) > 0) {
      throw failed('邮箱已存在');
    }
    if (await countPhone(phone, userId) > 0) {
      throw failed('手机号已存在');
    }
    await withTransaction((tx) => updateEmployee(tx, {
      orgUserId: employee.id,
      userId,
      name: employee.userName,
      phone,
      email,
      gender: employee.gender,
      departmentId: employee.departmentId ?? '',
      employeeId: employee.employeeId ?? '',
      employeeType: employee.employeeType ?? '',
      supervisorId: employee.supervisorId ?? '',
      position: employee.position ?? '',
      workCity: employee.workCity ?? '',
      enable: employee.enable,
      onboardingDate: employee.onboardingDate,
      operatorId: userId,
    }));
  }

  async changePassword(userId: string, originPassword: string, password: string): Promise<void> {
    const stored = await findPassword(userId);
    if (!stored || stored !== md5(originPassword)) {
      throw failed('原密码错误');
    }
    await updatePassword(userId, md5(password), userId);
    sessionStore.kick(userId);
  }

  deptUserTree(organizationId: string, includeDisabled: boolean, focusDepartmentId?: string) {
    return listDeptUserNodes(organizationId, includeDisabled).then((nodes) => buildTree(nodes.map((node) => ({
      ...node,
      enabled: focusDepartmentId && node.nodeType === 'USER' ? node.parentId === focusDepartmentId : node.enabled,
    }))));
  }

  async batchEdit(input: {
    ids: string[];
    organizationId: string;
    operatorId: string;
    departmentId?: string;
    supervisorId?: string;
    workCity?: string;
    onboardingDate?: number | null;
  }): Promise<void> {
    const updated = await batchEditEmployees(input);
    if (!updated) {
      throw notFound('部门不存在');
    }
  }

  private checkContact(phone: string, email: string): void {
    if (phone.length < 1 || phone.length > 11) {
      throw failed('手机号格式不正确');
    }
    if (!EMAIL.test(email)) {
      throw failed('邮箱格式不正确');
    }
  }
}

export const employeeService = new EmployeeService();
