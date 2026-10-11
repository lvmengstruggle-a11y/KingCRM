import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * 密码摘要：UTF-8 字节的小写十六进制 MD5。
 * 现有库中的密码就是这个摘要，登录校验必须保持同一算法。
 */
export function md5(src: string): string {
  if (!src) {
    throw new Error('Input for MD5 cannot be null or empty');
  }
  return createHash('md5').update(src, 'utf8').digest('hex');
}

export function md5Equals(plain: string, stored: string): boolean {
  const digest = md5(plain);
  const left = Buffer.from(digest);
  const right = Buffer.from(stored.toLowerCase());
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
