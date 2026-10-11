/** 登录成功后放进会话、返回给前端的用户。字段名对齐 UserDTO / SessionUser。 */
export interface SessionRole {
  id: string;
  name: string;
  dataScope: string;
  organizationId: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  password: string;
  enable: boolean;
  createTime: number;
  updateTime: number;
  language: string | null;
  lastOrganizationId: string;
  phone: string | null;
  source: string;
  createUser: string;
  updateUser: string;
  platformInfo: string | null;
  avatar: string | null;
  permissionIds: string[];
  organizationIds: string[];
  roles: SessionRole[];
  departmentId: string | null;
  departmentName: string | null;
  defaultPwd: boolean;
  csrfToken: string;
  sessionId: string;
}
