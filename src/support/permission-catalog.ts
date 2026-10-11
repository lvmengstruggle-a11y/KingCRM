import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { translate } from './i18n.js';

interface PermissionLeaf {
  id: string;
  name?: string;
  enable?: boolean;
}

interface PermissionNode {
  id: string;
  name: string;
  enable?: boolean;
  permissions?: PermissionLeaf[];
  children?: PermissionNode[];
}

const catalogPath = join(dirname(fileURLToPath(import.meta.url)), '../../resources/permission.json');

function loadCatalog(): PermissionNode[] {
  return JSON.parse(readFileSync(catalogPath, 'utf8')) as PermissionNode[];
}

export function allPermissionIds(): string[] {
  const ids: string[] = [];
  collectPermissionIds(loadCatalog(), ids);
  return ids;
}

function collectPermissionIds(nodes: PermissionNode[], ids: string[]): void {
  for (const node of nodes) {
    for (const permission of node.permissions ?? []) {
      ids.push(permission.id);
    }
    collectPermissionIds(node.children ?? [], ids);
  }
}

export function permissionCatalog(enabledIds: Set<string> = new Set()): PermissionNode[] {
  return loadCatalog().map((node) => decorate(structuredClone(node), enabledIds));
}

function decorate(node: PermissionNode, enabledIds: Set<string>): PermissionNode {
  node.name = translate(node.name, node.name);
  let allChecked = true;
  for (const child of node.children ?? []) {
    decorate(child, enabledIds);
    if (child.enable === false) {
      allChecked = false;
    }
  }
  let secondAll = true;
  for (const permission of node.permissions ?? []) {
    const key = permission.name ?? `permission.${permission.id.split(':').pop()?.toLowerCase() ?? ''}`;
    permission.name = translate(key, key);
    permission.enable = enabledIds.has(permission.id);
    if (!permission.enable) {
      secondAll = false;
    }
  }
  if ((node.permissions?.length ?? 0) > 0 && !secondAll) {
    allChecked = false;
  }
  if ((node.children?.length ?? 0) === 0 && (node.permissions?.length ?? 0) === 0) {
    allChecked = false;
  }
  node.enable = allChecked && ((node.children?.length ?? 0) > 0 || (node.permissions?.length ?? 0) > 0);
  return node;
}
