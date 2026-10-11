import { lookup } from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

import { AppError, failed, validateFailed } from './errors.js';

export interface SmtpInput {
  host: string;
  port: string;
  account: string;
  password: string;
  from: string;
  recipient: string;
  ssl: string;
  tsl: string;
}

const BLOCKED_HOST = '不允许使用内网或保留地址';

export function isBlockedAddress(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }
  const [first, second] = parts;
  if (first === 0 || first === 10 || first === 127) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }
  return false;
}

export async function assertPublicHost(host: string): Promise<void> {
  const name = host.trim();
  if (!name || /^(localhost|metadata\.google\.internal)$/i.test(name) || isBlockedAddress(name)) {
    throw validateFailed(BLOCKED_HOST);
  }
  let records;
  try {
    records = await lookup(name, { all: true });
  } catch {
    throw failed('连接失败');
  }
  if (records.length === 0 || records.some((record) => isBlockedAddress(record.address))) {
    throw validateFailed(BLOCKED_HOST);
  }
}

export async function testSmtp(input: SmtpInput): Promise<void> {
  await deliver(input);
}

export async function sendMail(input: SmtpInput, to: string, subject: string, text: string): Promise<void> {
  const from = input.from.includes('@') ? input.from : input.account;
  const body = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..'),
    '.',
  ].join('\r\n');
  await deliver(input, { from, to, body });
}

async function deliver(input: SmtpInput, mail?: { from: string; to: string; body: string }): Promise<void> {
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw validateFailed('SMTP 端口不正确');
  }
  await assertPublicHost(input.host);
  try {
    await runSmtp(input, port, mail);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw failed('连接失败');
  }
}

async function runSmtp(
  input: SmtpInput,
  port: number,
  mail?: { from: string; to: string; body: string },
): Promise<void> {
  const implicitTls = input.ssl === 'true';
  let socket: net.Socket = implicitTls
    ? tls.connect({ host: input.host, port, servername: input.host })
    : net.connect({ host: input.host, port });
  socket.setTimeout(10000);
  await once(socket, 'connect');
  await expectCode(socket, 220);
  await command(socket, 'EHLO cordys', 250);
  if (!implicitTls && input.tsl === 'true') {
    await command(socket, 'STARTTLS', 220);
    socket = tls.connect({ socket, servername: input.host });
    await once(socket, 'secureConnect');
    await command(socket, 'EHLO cordys', 250);
  }
  if (input.account) {
    await command(socket, 'AUTH LOGIN', 334);
    await command(socket, Buffer.from(input.account).toString('base64'), 334);
    await command(socket, Buffer.from(input.password).toString('base64'), 235);
  }
  if (mail) {
    await command(socket, `MAIL FROM:<${mail.from}>`, 250);
    await command(socket, `RCPT TO:<${mail.to}>`, 250);
    await command(socket, 'DATA', 354);
    await command(socket, mail.body, 250);
  } else if (input.recipient.trim()) {
    const from = input.from.includes('@') ? input.from : input.account;
    await command(socket, `MAIL FROM:<${from}>`, 250);
    await command(socket, `RCPT TO:<${input.recipient.trim()}>`, 250);
    await command(socket, 'DATA', 354);
    const body = [
      `From: ${from}`,
      `To: ${input.recipient.trim()}`,
      'Subject: Cordys CRM test',
      '',
      'Cordys CRM SMTP connection test',
      '.',
    ].join('\r\n');
    await command(socket, body, 250);
  }
  await command(socket, 'QUIT', 221);
  socket.end();
}

function command(socket: net.Socket, line: string, code: number): Promise<string> {
  socket.write(`${line}\r\n`);
  return expectCode(socket, code);
}

function expectCode(socket: net.Socket, code: number): Promise<string> {
  return readReply(socket).then((reply) => {
    if (!reply.startsWith(String(code))) {
      throw failed('连接失败');
    }
    return reply;
  });
}

function readReply(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter((line) => line.length > 0);
      const last = lines.at(-1);
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('timeout', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('timeout', onError);
  });
}

function once(socket: net.Socket, event: 'connect' | 'secureConnect'): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      socket.off(event, onReady);
      socket.off('error', onError);
      socket.off('timeout', onError);
    };
    socket.once(event, onReady);
    socket.once('error', onError);
    socket.once('timeout', onError);
  });
}
