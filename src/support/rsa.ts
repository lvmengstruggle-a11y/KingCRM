import { constants, createPrivateKey, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt, type KeyObject } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 登录公钥：1024 位 RSA，公钥为 X.509 SPKI 的 Base64，供前端 JSEncrypt 使用。
 * 前端加密填充是 PKCS#1 v1.5，解密必须用同一填充。
 */
class RsaKeyStore {
  private publicKeyDer = '';
  private privateKey: KeyObject | null = null;

  getPublicKey(): string {
    this.ensure();
    return this.publicKeyDer;
  }

  decrypt(cipherText: string): string {
    this.ensure();
    const payload = Buffer.from(cipherText, 'base64');
    const plain = privateDecrypt(
      {
        key: this.privateKey as KeyObject,
        padding: constants.RSA_PKCS1_PADDING,
      },
      payload,
    );
    return plain.toString('utf8');
  }

  private ensure(): void {
    if (this.privateKey) {
      return;
    }
    const loaded = readKeyFile();
    if (loaded) {
      this.privateKey = loaded.privateKey;
      this.publicKeyDer = loaded.publicKeyDer;
      return;
    }
    const pair = generateKeyPairSync('rsa', { modulusLength: 1024 });
    this.privateKey = pair.privateKey;
    this.publicKeyDer = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    writeKeyFile(this.privateKey, this.publicKeyDer);
  }
}

const keyFile = path.resolve(process.cwd(), '.data/login-rsa.json');

function readKeyFile(): { privateKey: KeyObject; publicKeyDer: string } | null {
  try {
    const parsed = JSON.parse(readFileSync(keyFile, 'utf8')) as { privateKeyPem?: string; publicKeyDer?: string };
    if (!parsed.privateKeyPem || !parsed.publicKeyDer) {
      return null;
    }
    const privateKey = createPrivateKey(parsed.privateKeyPem);
    const publicKeyDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
    if (publicKeyDer !== parsed.publicKeyDer) {
      return null;
    }
    return { privateKey, publicKeyDer };
  } catch {
    return null;
  }
}

function writeKeyFile(privateKey: KeyObject, publicKeyDer: string): void {
  mkdirSync(path.dirname(keyFile), { recursive: true });
  const privateKeyPem = String(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(keyFile, JSON.stringify({ privateKeyPem, publicKeyDer }), { mode: 0o600 });
}

export const rsaKeyStore = new RsaKeyStore();

/** 测试用：用同一公钥做 PKCS#1 加密，验证解密闭环。 */
export function encryptWithPublicKey(publicKeyBase64: string, plain: string): string {
  const pem = `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64}\n-----END PUBLIC KEY-----`;
  const encrypted = publicEncrypt(
    {
      key: pem,
      padding: constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(plain, 'utf8'),
  );
  return encrypted.toString('base64');
}
