import { validateFailed } from './errors.js';

export interface MultipartFile {
  field: string;
  filename: string;
  data: Buffer;
}

export interface MultipartBody {
  fields: Map<string, string>;
  files: MultipartFile[];
}

/** 解析浏览器 FormData。界面保存和术语导入都走这个格式。 */
export function parseMultipart(body: Buffer, contentType: string): MultipartBody {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] || match?.[2];
  if (!boundary) {
    throw validateFailed('上传格式不正确');
  }
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = new Map<string, string>();
  const files: MultipartFile[] = [];
  let offset = body.indexOf(delimiter);
  while (offset >= 0) {
    const start = offset + delimiter.length;
    if (body.subarray(start, start + 2).toString() === '--') {
      break;
    }
    const next = body.indexOf(delimiter, start);
    const part = body.subarray(start, next < 0 ? body.length : next);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      let data = part.subarray(headerEnd + 4);
      if (data.subarray(-2).toString() === '\r\n') {
        data = data.subarray(0, -2);
      }
      const name = /name="([^"]+)"/.exec(headers)?.[1] ?? '';
      const filename = /filename="([^"]*)"/.exec(headers)?.[1];
      if (filename) {
        files.push({ field: name, filename, data });
      } else if (name) {
        fields.set(name, data.toString('utf8'));
      }
    }
    offset = next;
  }
  return { fields, files };
}
