/** MySQL BIT(1) 经 mysql2 读出来通常是 Buffer。 */
export function bitToBool(value: unknown): boolean {
  if (Buffer.isBuffer(value)) {
    return value.length > 0 && value[0] === 1;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  if (typeof value === 'bigint') {
    return value === 1n;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return false;
}

export function asNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value !== '') {
    return Number(value);
  }
  return 0;
}

export function asString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return String(value);
}
