import { randomBytes } from 'node:crypto';

/** 32 位十六进制主键，兼容现有 VARCHAR(32) 主键，不占用 Java UID worker。 */
export function nextId(): string {
  return randomBytes(16).toString('hex');
}
