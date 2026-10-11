import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RowDataPacket } from 'mysql2';

import { applyBusinessField } from '../support/business-field.js';
import { query, withTransaction } from '../support/db.js';
import { nextId } from '../support/id.js';

const formDir = join(dirname(fileURLToPath(import.meta.url)), '../../resources/form');
const formProp = readFileSync(join(formDir, 'form.json'), 'utf8');
const fieldMap = JSON.parse(readFileSync(join(formDir, 'field.json'), 'utf8')) as Record<string, Array<Record<string, unknown>>>;

let seeding: Promise<void> | null = null;

export async function ensureDefaultForms(organizationId: string): Promise<void> {
  if (!seeding) {
    seeding = seedMissing(organizationId).finally(() => {
      seeding = null;
    });
  }
  await seeding;
}

async function seedMissing(organizationId: string): Promise<void> {
  const orgs = await query<RowDataPacket>('SELECT id FROM sys_organization WHERE id = ? LIMIT 1', [organizationId]);
  if (!orgs[0]) {
    return;
  }
  const existing = await query<RowDataPacket & { form_key: string }>(
    'SELECT form_key FROM sys_module_form WHERE organization_id = ?',
    [organizationId],
  );
  const present = new Set(existing.map((row) => row.form_key));
  const missing = Object.keys(fieldMap).filter((key) => !present.has(key));
  if (missing.length === 0) {
    return;
  }
  const now = Date.now();
  await withTransaction(async (tx) => {
    for (const formKey of missing) {
      const formId = nextId();
      await tx.execute(
        `INSERT INTO sys_module_form
         (id, form_key, organization_id, create_time, update_time, create_user, update_user)
         VALUES (?, ?, ?, ?, ?, 'admin', 'admin')`,
        [formId, formKey, organizationId, now, now],
      );
      await tx.execute('INSERT INTO sys_module_form_blob (id, prop) VALUES (?, ?)', [formId, formProp]);
      const ids = new Map<string, string>();
      const source = fieldMap[formKey] ?? [];
      const fields = source.filter((field) => !('ext_ver' in field)).map((field) => structuredClone(field));
      for (const field of fields) {
        const internalKey = String(field.internalKey ?? '');
        const id = nextId();
        if (internalKey && !ids.has(internalKey)) {
          ids.set(internalKey, id);
        }
        field.id = id;
      }
      let pos = 1;
      for (const field of fields) {
        const rules = field.showControlRules;
        if (Array.isArray(rules)) {
          for (const rule of rules) {
            if (!rule || typeof rule !== 'object' || !Array.isArray((rule as { fieldIds?: unknown }).fieldIds)) {
              continue;
            }
            const current = rule as { fieldIds: string[] };
            current.fieldIds = current.fieldIds.map((key) => ids.get(key) ?? key);
          }
        }
        if (Array.isArray(field.showFields)) {
          field.showFields = field.showFields.map((key) => (typeof key === 'string' ? ids.get(key) ?? key : key));
        }
        if (Array.isArray(field.subFields)) {
          for (const subField of field.subFields) {
            if (subField && typeof subField === 'object' && !(subField as { id?: string }).id) {
              (subField as { id: string }).id = nextId();
            }
          }
        }
        applyBusinessField(field);
        const id = String(field.id);
        await tx.execute(
          `INSERT INTO sys_module_field
           (id, form_id, internal_key, name, type, mobile, pos, create_user, create_time, update_user, update_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'admin', ?, 'admin', ?)`,
          [
            id,
            formId,
            field.internalKey ?? null,
            String(field.name ?? ''),
            String(field.type ?? 'INPUT'),
            field.mobile ? 1 : 0,
            pos,
            now,
            now,
          ],
        );
        pos += 1;
        await tx.execute('INSERT INTO sys_module_field_blob (id, prop) VALUES (?, ?)', [id, JSON.stringify(field)]);
      }
    }
  });
}
