import { arch } from 'node:os';

import { config } from '../config/index.js';
import { listNavigation, moveNavigation, type NavigationRecord } from '../models/navigation.model.js';
import { notFound } from '../support/errors.js';

export interface VersionInfo {
  currentVersion: string;
  latestVersion: string;
  architecture: string;
  copyright: string;
  hasNewVersion: boolean;
}

export class SystemService {
  getVersion(): VersionInfo {
    return {
      currentVersion: config.crmVersion,
      latestVersion: config.crmVersion,
      architecture: normalizeArch(arch()),
      copyright: '',
      hasNewVersion: false,
    };
  }

  listNavigation(organizationId: string): Promise<NavigationRecord[]> {
    return listNavigation(organizationId);
  }

  async sortNavigation(id: string, organizationId: string, start: number, end: number, userId: string): Promise<void> {
    const moved = await moveNavigation(id, organizationId, start, end, userId);
    if (!moved) {
      throw notFound('导航不存在');
    }
  }
}

export const systemService = new SystemService();

function normalizeArch(value: string): string {
  if (value === 'arm64' || value === 'aarch64') {
    return 'arm64';
  }
  return 'amd64';
}
