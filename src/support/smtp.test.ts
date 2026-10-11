import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isBlockedAddress } from './smtp.js';

describe('smtp host check', () => {
  it('rejects loopback, private and link-local addresses', () => {
    assert.equal(isBlockedAddress('127.0.0.1'), true);
    assert.equal(isBlockedAddress('10.1.2.3'), true);
    assert.equal(isBlockedAddress('192.168.1.8'), true);
    assert.equal(isBlockedAddress('172.16.0.1'), true);
    assert.equal(isBlockedAddress('169.254.1.1'), true);
    assert.equal(isBlockedAddress('::1'), true);
  });

  it('allows a public address', () => {
    assert.equal(isBlockedAddress('8.8.8.8'), false);
    assert.equal(isBlockedAddress('smtp.example.com'), false);
  });
});
