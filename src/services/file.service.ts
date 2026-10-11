import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { notFound } from '../support/errors.js';
import { nextId } from '../support/id.js';

const root = path.join(process.cwd(), 'data', 'files');

export async function saveTempFiles(files: Array<{ filename: string; data: Buffer }>): Promise<string[]> {
  await mkdir(root, { recursive: true });
  const ids: string[] = [];
  for (const file of files) {
    const id = nextId();
    await writeFile(path.join(root, id), file.data);
    await writeFile(path.join(root, `${id}.json`), JSON.stringify({ filename: file.filename || 'file' }));
    ids.push(id);
  }
  return ids;
}

export async function readTempFile(id: string): Promise<{ data: Buffer; filename: string }> {
  if (!/^[a-z0-9]+$/i.test(id)) {
    throw notFound('文件不存在');
  }
  try {
    const data = await readFile(path.join(root, id));
    const meta = JSON.parse(await readFile(path.join(root, `${id}.json`), 'utf8')) as { filename?: string };
    return { data, filename: meta.filename || 'file' };
  } catch {
    throw notFound('文件不存在');
  }
}

export async function deleteTempFile(id: string): Promise<void> {
  if (!/^[a-z0-9]+$/i.test(id)) {
    throw notFound('文件不存在');
  }
  await unlink(path.join(root, id)).catch(() => undefined);
  await unlink(path.join(root, `${id}.json`)).catch(() => undefined);
}

export function fileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}
