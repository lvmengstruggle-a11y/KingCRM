import { inflateSync } from 'node:zlib';

import type { RowDataPacket } from 'mysql2';

import { bitToBool, asNumber } from '../support/bit.js';
import { query, withTransaction } from '../support/db.js';
import { nextId } from '../support/id.js';
import { validateFailed } from '../support/errors.js';
import { applyBusinessField } from '../support/business-field.js';
import { ensureDefaultForms } from './form-seed.js';

export interface FormField {
  id: string;
  name: string;
  type: string;
  pos: number;
  mobile: boolean;
  internalKey: string | null;
  businessKey?: string;
  [key: string]: unknown;
}

export interface FormConfig {
  fields: FormField[];
  formProp: Record<string, unknown>;
}

interface FormRow extends RowDataPacket {
  id: string;
}

interface FieldRow extends RowDataPacket {
  id: string;
  name: string;
  type: string;
  pos: number | string;
  mobile: unknown;
  internal_key: string | null;
  prop: string | null;
}

interface PropRow extends RowDataPacket {
  prop: string | null;
}

function parseJson(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export async function findFormId(formKey: string, organizationId: string): Promise<string | null> {
  const rows = await query<FormRow>(
    'SELECT id FROM sys_module_form WHERE form_key = ? AND organization_id = ? LIMIT 1',
    [formKey, organizationId],
  );
  return rows[0]?.id ?? null;
}

function sqlIdent(name: string): string {
  if (!/^[a-z_]+$/.test(name)) {
    throw validateFailed('快照配置不正确');
  }
  return name;
}

function decodeSnapshotText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }
  try {
    return inflateSync(Buffer.from(trimmed, 'base64')).toString('utf8');
  } catch {
    return raw;
  }
}

function snapshotConfig(raw: string): FormConfig | null {
  const parsed = parseJson(decodeSnapshotText(raw));
  if (!parsed || !Array.isArray(parsed.fields)) {
    return null;
  }
  const formProp = parsed.formProp;
  return {
    fields: parsed.fields as FormField[],
    formProp: formProp && typeof formProp === 'object' && !Array.isArray(formProp) ? (formProp as Record<string, unknown>) : {},
  };
}

export async function getFormSnapshot(
  snapshot: { table: string; idColumn: string; propColumn: string },
  recordTable: string,
  recordId: string,
  formKey: string,
  organizationId: string,
): Promise<FormConfig> {
  const table = sqlIdent(snapshot.table);
  const idColumn = sqlIdent(snapshot.idColumn);
  const propColumn = sqlIdent(snapshot.propColumn);
  const parent = sqlIdent(recordTable);
  const rows = await query<PropRow>(
    `SELECT s.${propColumn} AS prop
     FROM ${table} s
     INNER JOIN ${parent} r ON r.id = s.${idColumn}
     WHERE s.${idColumn} = ? AND r.organization_id = ?
     LIMIT 1`,
    [recordId, organizationId],
  );
  const stored = rows[0]?.prop;
  if (stored) {
    const decoded = snapshotConfig(stored);
    if (decoded) {
      return decoded;
    }
  }
  return getFormConfig(formKey, organizationId);
}

export async function getFormConfig(formKey: string, organizationId: string): Promise<FormConfig> {
  await ensureDefaultForms(organizationId);
  const formId = await findFormId(formKey, organizationId);
  if (!formId) {
    return { fields: [], formProp: {} };
  }
  const propRows = await query<PropRow>('SELECT prop FROM sys_module_form_blob WHERE id = ? LIMIT 1', [formId]);
  const fields = await query<FieldRow>(
    `SELECT f.id, f.name, f.type, f.pos, f.mobile, f.internal_key, b.prop
     FROM sys_module_field f
     LEFT JOIN sys_module_field_blob b ON b.id = f.id
     WHERE f.form_id = ?
     ORDER BY f.pos`,
    [formId],
  );
  return {
    formProp: parseJson(propRows[0]?.prop) ?? {},
    fields: fields.map((field) => {
      const stored = parseJson(field.prop) ?? {};
      const merged = {
        ...stored,
        id: field.id,
        name: field.name,
        type: field.type,
        pos: asNumber(field.pos),
        mobile: bitToBool(field.mobile),
        internalKey: field.internal_key,
      };
      applyBusinessField(merged);
      return merged;
    }),
  };
}

export async function saveFormConfig(input: {
  formKey: string;
  organizationId: string;
  userId: string;
  fields?: FormField[];
  formProp?: Record<string, unknown>;
}): Promise<FormConfig> {
  if (!input.formKey.trim()) {
    throw validateFailed('表单不能为空');
  }
  const now = Date.now();
  await withTransaction(async (tx) => {
    const forms = await tx.query<FormRow>(
      'SELECT id FROM sys_module_form WHERE form_key = ? AND organization_id = ? LIMIT 1',
      [input.formKey, input.organizationId],
    );
    let formId = forms[0]?.id;
    if (!formId) {
      formId = nextId();
      await tx.execute(
        `INSERT INTO sys_module_form
         (id, form_key, organization_id, create_time, update_time, create_user, update_user)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [formId, input.formKey, input.organizationId, now, now, input.userId, input.userId],
      );
      await tx.execute('INSERT INTO sys_module_form_blob (id, prop) VALUES (?, ?)', [
        formId,
        JSON.stringify(input.formProp ?? {}),
      ]);
    } else {
      await tx.execute('UPDATE sys_module_form SET update_time = ?, update_user = ? WHERE id = ?', [
        now,
        input.userId,
        formId,
      ]);
      if (input.formProp) {
        const blobs = await tx.query<FormRow>('SELECT id FROM sys_module_form_blob WHERE id = ? LIMIT 1', [formId]);
        if (blobs[0]) {
          await tx.execute('UPDATE sys_module_form_blob SET prop = ? WHERE id = ?', [JSON.stringify(input.formProp), formId]);
        } else {
          await tx.execute('INSERT INTO sys_module_form_blob (id, prop) VALUES (?, ?)', [formId, JSON.stringify(input.formProp)]);
        }
      }
    }

    if (!input.fields) {
      return;
    }
    const existing = await tx.query<FormRow>('SELECT id FROM sys_module_field WHERE form_id = ?', [formId]);
    if (existing.length > 0) {
      const marks = existing.map(() => '?').join(', ');
      const ids = existing.map((row) => row.id);
      await tx.execute(`DELETE FROM sys_module_field_blob WHERE id IN (${marks})`, ids);
      await tx.execute(`DELETE FROM sys_module_field WHERE id IN (${marks})`, ids);
    }
    for (const [index, field] of input.fields.entries()) {
      const id = field.id || nextId();
      const name = String(field.name ?? '').trim();
      const type = String(field.type ?? 'INPUT');
      if (!name) {
        throw validateFailed('字段名称不能为空');
      }
      await tx.execute(
        `INSERT INTO sys_module_field
         (id, form_id, internal_key, name, type, mobile, pos, create_user, create_time, update_user, update_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          formId,
          field.internalKey ?? null,
          name,
          type,
          field.mobile ? 1 : 0,
          field.pos ?? index,
          input.userId,
          now,
          input.userId,
          now,
        ],
      );
      await tx.execute(`INSERT INTO sys_module_field_blob (id, prop) VALUES (?, ?)`, [
        id,
        JSON.stringify({ ...field, id, name, type }),
      ]);
    }
  });
  return getFormConfig(input.formKey, input.organizationId);
}
