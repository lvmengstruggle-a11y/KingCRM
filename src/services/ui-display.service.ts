import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { execute, query, type SqlRow } from '../support/db.js';
import { notFound, validateFailed } from '../support/errors.js';

const DEFAULT_ORG = '100001';

export interface UiSettingInput {
  paramKey?: string;
  paramValue?: string;
  type?: string;
  original?: boolean;
  fileName?: string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function storageKey(organizationId: string, paramKey: string): string {
  return `${organizationId}:${paramKey}`;
}

function directory(organizationId: string): string {
  return join(process.cwd(), 'data', 'ui', organizationId);
}

function assertKey(paramKey: string): void {
  if (!/^ui\.[A-Za-z0-9]+$/.test(paramKey)) {
    throw validateFailed('界面参数不正确');
  }
}

export class UiDisplayService {
  async info(organizationId: string): Promise<Record<string, unknown>[]> {
    const orgId = organizationId || DEFAULT_ORG;
    const rows = await query<SqlRow & { param_key: string; param_value: string | null; type: string }>(
      'SELECT param_key, param_value, type FROM sys_ui_settings WHERE organization_id = ? OR param_key LIKE ?',
      [orgId, `${orgId}:%`],
    );
    return rows.map((row) => {
      const paramKey = row.param_key.includes(':') ? row.param_key.slice(row.param_key.indexOf(':') + 1) : row.param_key;
      const filename = row.param_value ?? '';
      return {
        paramKey,
        paramValue: filename,
        type: row.type,
        file: row.type === 'file' ? filename : '',
        fileName: row.type === 'file' ? filename : '',
      };
    });
  }

  async save(items: UiSettingInput[], files: { filename: string; data: Buffer }[], organizationId: string): Promise<void> {
    const orgId = organizationId || DEFAULT_ORG;
    const byName = new Map(files.map((file) => [file.filename, file]));
    for (const item of items) {
      const paramKey = String(item.paramKey ?? '');
      assertKey(paramKey);
      const key = storageKey(orgId, paramKey);
      if (item.original) {
        await execute('DELETE FROM sys_ui_settings WHERE param_key = ?', [key]);
        await rm(join(directory(orgId), paramKey), { force: true });
        continue;
      }
      let value = String(item.paramValue ?? '').slice(0, 255);
      const type = item.type === 'file' ? 'file' : 'text';
      const uploaded = [...byName.entries()].find(([name]) => name.startsWith(`${paramKey},`) || name === paramKey);
      if (uploaded) {
        const filename = uploaded[0].includes(',') ? uploaded[0].slice(uploaded[0].indexOf(',') + 1) : (item.fileName || paramKey);
        await mkdir(directory(orgId), { recursive: true });
        await writeFile(join(directory(orgId), paramKey), uploaded[1].data);
        value = filename.slice(0, 255);
      }
      await execute(
        `INSERT INTO sys_ui_settings (param_key, param_value, type, organization_id)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE param_value = VALUES(param_value), type = VALUES(type), organization_id = VALUES(organization_id)`,
        [key, value, type, orgId],
      );
    }
  }

  async preview(paramKey: string, organizationId: string): Promise<{ body: Buffer; type: string }> {
    assertKey(paramKey);
    const orgId = organizationId || DEFAULT_ORG;
    const rows = await query<SqlRow & { param_value: string | null }>(
      'SELECT param_value FROM sys_ui_settings WHERE param_key = ?',
      [storageKey(orgId, paramKey)],
    );
    try {
      const body = await readFile(join(directory(orgId), paramKey));
      const filename = rows[0]?.param_value ?? '';
      return { body, type: CONTENT_TYPES[extname(filename).toLowerCase()] ?? 'application/octet-stream' };
    } catch {
      throw notFound('图片不存在');
    }
  }
}

export const uiDisplayService = new UiDisplayService();
