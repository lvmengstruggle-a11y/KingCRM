import { nextId } from '../support/id.js';
import { execute, type Tx } from '../support/db.js';

export async function insertOperationLog(
  input: {
    organizationId: string;
    type: 'ADD' | 'UPDATE' | 'DELETE';
    module: string;
    resourceId: string;
    resourceName: string;
    operator: string;
    path: string;
    method: string;
  },
  tx?: Tx,
): Promise<void> {
  const sql = `INSERT INTO sys_operation_log
      (id, organization_id, type, module, resource_id, resource_name, detail, create_time, create_user, path, method)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`;
  const params = [
    nextId(),
    input.organizationId,
    input.type,
    input.module,
    input.resourceId,
    input.resourceName,
    Date.now(),
    input.operator,
    input.path,
    input.method,
  ];
  if (tx) {
    await tx.execute(sql, params);
    return;
  }
  await execute(sql, params);
}
