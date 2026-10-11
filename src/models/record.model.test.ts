import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isBlankNumber, type ColumnMeta } from './record.model.js';

function column(dataType: string): ColumnMeta {
  return { column: 'possible', field: 'possible', dataType, columnType: dataType, nullable: true };
}

describe('isBlankNumber', () => {
  it('treats an empty decimal as blank so MySQL does not receive an empty string', () => {
    assert.equal(isBlankNumber(column('decimal'), ''), true);
    assert.equal(isBlankNumber(column('decimal'), '  '), true);
    assert.equal(isBlankNumber(column('bigint'), ''), true);
  });

  it('keeps real numbers and text columns', () => {
    assert.equal(isBlankNumber(column('decimal'), 0), false);
    assert.equal(isBlankNumber(column('decimal'), '20'), false);
    assert.equal(isBlankNumber(column('varchar'), ''), false);
  });
});
