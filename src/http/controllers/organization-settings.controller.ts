import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getEmailConfig,
  latestSyncResource,
  listThirdPartyConfigs,
  saveEmailConfig,
  saveThirdPartyConfig,
  switchThirdParty,
  testThirdParty,
  verifyEmailConfig,
} from '../../services/organization-config.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';

const emailSchema = z.object({
  host: z.string().optional().default(''),
  port: z.string().optional().default(''),
  account: z.string().optional().default(''),
  password: z.string().optional().default(''),
  from: z.string().optional().default(''),
  recipient: z.string().optional().default(''),
  ssl: z.string().optional().default('false'),
  tsl: z.string().optional().default('false'),
});

const thirdPartySchema = z.object({
  type: z.string().min(1),
  verify: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function registerOrganizationSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/organization/settings/email', { preHandler: requirePermission(Permission.SYSTEM_SETTING_READ) }, async (request) => {
    return success(await getEmailConfig(requireOrganization(request)));
  });

  app.post('/organization/settings/email/edit', { preHandler: requirePermission(Permission.SYSTEM_SETTING_UPDATE) }, async (request) => {
    const body = emailSchema.parse(request.body);
    await saveEmailConfig(requireOrganization(request), requireUser(request).id, body);
    return success(null);
  });

  app.post('/organization/settings/email/test', { preHandler: requirePermission(Permission.SYSTEM_SETTING_READ) }, async (request) => {
    requireUser(request);
    await verifyEmailConfig(emailSchema.parse(request.body));
    return success(null);
  });

  app.get('/organization/settings/third-party', { preHandler: requirePermission(Permission.SYSTEM_SETTING_READ) }, async (request) => {
    return success(await listThirdPartyConfigs(requireOrganization(request)));
  });

  app.post('/organization/settings/third-party/edit', { preHandler: requirePermission(Permission.SYSTEM_SETTING_UPDATE) }, async (request) => {
    const body = thirdPartySchema.parse(request.body);
    return success(await saveThirdPartyConfig(requireOrganization(request), requireUser(request).id, body));
  });

  app.post('/organization/settings/third-party/test', { preHandler: requirePermission(Permission.SYSTEM_SETTING_READ) }, async (request) => {
    requireUser(request);
    return success(await testThirdParty(thirdPartySchema.parse(request.body)));
  });

  app.get('/organization/settings/switch-third-party', { preHandler: requirePermission(Permission.SYSTEM_SETTING_UPDATE) }, async (request) => {
    const type = z.object({ type: z.string().min(1) }).parse(request.query).type;
    await switchThirdParty(requireOrganization(request), requireUser(request).id, type);
    return success(null);
  });

  app.get('/organization/settings/third-party/sync/resource', async (request) => {
    requireUser(request);
    return success(await latestSyncResource(requireOrganization(request)));
  });
}
