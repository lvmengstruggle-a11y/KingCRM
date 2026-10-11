import { validateFailed } from './errors.js';

export function ident(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(name)) {
    throw validateFailed('非法字段');
  }
  return `\`${name}\``;
}

export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function camelToSnake(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
