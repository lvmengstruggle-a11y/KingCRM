import { randomBytes } from 'node:crypto';

/** 32 位十六进制主键，对应现有 VARCHAR(32) 主键。 */
export function nextId(): string {
  return randomBytes(16).toString('hex');
}
