import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { md5, md5Equals } from './coding.js';

describe('md5', () => {
  it('matches the UTF-8 hex digest used by the Java backend', () => {
    assert.equal(md5('admin'), '21232f297a57a5a743894a0e4a801fc3');
    assert.match(md5('KingCRM'), /^[0-9a-f]{32}$/);
  });

  it('compares a stored digest in constant time when lengths match', () => {
    assert.equal(md5Equals('admin', '21232f297a57a5a743894a0e4a801fc3'), true);
    assert.equal(md5Equals('admin', '00000000000000000000000000000000'), false);
    assert.equal(md5Equals('admin', 'short'), false);
  });
});
