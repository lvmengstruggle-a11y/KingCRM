import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildTree } from './tree.js';

describe('buildTree', () => {
  it('treats NONE as the root and keeps sibling order', () => {
    const tree = buildTree([
      { id: 'root', name: '公司', parentId: 'NONE', organizationId: 'org' },
      { id: 'sales', name: '销售', parentId: 'root', organizationId: 'org' },
      { id: 'east', name: '华东', parentId: 'sales', organizationId: 'org' },
      { id: 'rd', name: '研发', parentId: 'root', organizationId: 'org' },
    ]);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.id, 'root');
    assert.deepEqual(tree[0]?.children.map((node) => node.id), ['sales', 'rd']);
    assert.equal(tree[0]?.children[0]?.children[0]?.id, 'east');
  });
});
