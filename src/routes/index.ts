import type { FastifyInstance } from 'fastify';

import { registerAiSettingRoutes, registerUiDisplayRoutes } from '../http/controllers/ai-setting.controller.js';
import { registerApprovalRoutes } from '../http/controllers/approval.controller.js';
import { registerAuthRoutes } from '../http/controllers/auth.controller.js';
import { registerDepartmentRoutes } from '../http/controllers/department.controller.js';
import { registerRoleRoutes } from '../http/controllers/role.controller.js';
import { registerSettingsRoutes } from '../http/controllers/settings.controller.js';
import { registerCrmRoutes } from '../http/controllers/crm.controller.js';
import { registerFolderRoutes } from '../http/controllers/folder.controller.js';
import { registerFinishRoutes } from '../http/controllers/finish.controller.js';
import { registerGapRoutes } from '../http/controllers/gap.controller.js';
import { registerHomeRoutes } from '../http/controllers/home.controller.js';
import { registerMessageRoutes } from '../http/controllers/message.controller.js';
import { registerOrganizationSettingsRoutes } from '../http/controllers/organization-settings.controller.js';
import { registerPageRestRoutes } from '../http/controllers/page-rest.controller.js';
import { registerSystemRoutes } from '../http/controllers/system.controller.js';
import { registerTicketRoutes } from '../http/controllers/ticket.controller.js';
import { registerUserRoutes } from '../http/controllers/user.controller.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await registerSystemRoutes(app);
  await registerAuthRoutes(app);
  await registerDepartmentRoutes(app);
  await registerUserRoutes(app);
  await registerRoleRoutes(app);
  await registerSettingsRoutes(app);
  await registerOrganizationSettingsRoutes(app);
  await registerMessageRoutes(app);
  await registerCrmRoutes(app);
  await registerTicketRoutes(app);
  await registerGapRoutes(app);
  await registerFinishRoutes(app);
  await registerPageRestRoutes(app);
  await registerHomeRoutes(app);
  await registerFolderRoutes(app);
  await registerApprovalRoutes(app);
  await registerAiSettingRoutes(app);
  await registerUiDisplayRoutes(app);
}
