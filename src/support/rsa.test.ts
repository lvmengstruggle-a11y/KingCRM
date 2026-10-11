import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { encryptWithPublicKey, rsaKeyStore } from './rsa.js';

describe('rsa', () => {
  it('decrypts a PKCS#1 payload produced for the published public key', () => {
    const publicKey = rsaKeyStore.getPublicKey();
    const cipher = encryptWithPublicKey(publicKey, 'CordysCRM');
    assert.equal(rsaKeyStore.decrypt(cipher), 'CordysCRM');
  });
});
