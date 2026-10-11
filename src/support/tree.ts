export interface TreeNode {
  id: string;
  name: string;
  parentId: string;
  organizationId?: string;
  children: TreeNode[];
}

export type Tree<T> = T & { children: Tree<T>[] };

/** 与 BaseTreeNode.buildTree 相同：parentId 为空或 NONE 的节点作为根。 */
export function buildTree<T extends { id: string; parentId: string }>(nodes: T[]): Tree<T>[] {
  const mapped: Tree<T>[] = nodes.map((node) => ({ ...node, children: [] }));
  const byId = new Map(mapped.map((node) => [node.id, node]));
  const roots: Tree<T>[] = [];

  for (const node of mapped) {
    if (!node.parentId || node.parentId.toUpperCase() === 'NONE') {
      roots.push(node);
      continue;
    }
    const parent = byId.get(node.parentId);
    if (parent) {
      parent.children.push(node);
    }
  }

  return roots;
}
