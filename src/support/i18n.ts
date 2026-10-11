import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const propertiesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../resources/i18n/kingcrm_zh_CN.properties',
);

const messages = loadMessages(propertiesPath);

function loadMessages(path: string): Map<string, string> {
  const map = new Map<string, string>();
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return map;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const index = trimmed.indexOf('=');
    if (index <= 0) {
      continue;
    }
    map.set(trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim());
  }
  return map;
}

export function translate(key: string, fallback = key): string {
  return messages.get(key) ?? fallback;
}
