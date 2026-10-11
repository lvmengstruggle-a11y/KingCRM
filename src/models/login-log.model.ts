import { nextId } from '../support/id.js';
import { query } from '../support/db.js';

export async function insertLoginLog(input: {
  operator: string;
  loginAddress: string;
  platform: string;
}): Promise<void> {
  await query(
    `INSERT INTO sys_login_log (id, create_time, operator, login_address, platform)
     VALUES (?, ?, ?, ?, ?)`,
    [nextId(), Date.now(), input.operator, input.loginAddress, input.platform],
  );
}
