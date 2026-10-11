import { z } from 'zod';

export const userPageSchema = z.object({
  current: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
  keyword: z.string().optional(),
  departmentIds: z.array(z.string().trim().min(1)).min(1, '部门不能为空'),
  sort: z.object({
    name: z.string().min(1),
    type: z.string().min(1),
  }).optional(),
  filters: z.array(z.unknown()).optional(),
  combineSearch: z.object({
    conditions: z.array(z.unknown()).optional(),
  }).optional(),
});

export const includeDisabledSchema = z.object({
  includeDisabled: z.enum(['true', 'false']).optional(),
});

export const employeeSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(1).max(11),
  email: z.string().trim().min(1).max(255),
  gender: z.boolean(),
  departmentId: z.string().trim().min(1),
  employeeId: z.string().optional(),
  employeeType: z.string().optional(),
  supervisorId: z.string().optional(),
  position: z.string().optional(),
  workCity: z.string().optional(),
  roleIds: z.array(z.string()).optional(),
  enable: z.boolean().optional(),
  onboardingDate: z.number().nullable().optional(),
});

export const employeeUpdateSchema = employeeSchema.extend({
  id: z.string().trim().min(1),
});

export const batchEnableSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  enable: z.boolean(),
});

export const batchIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export const renameSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(1).max(255),
});

export const personalInfoSchema = z.object({
  phone: z.string().trim().min(1).max(11),
  email: z.string().trim().min(1).max(255),
  code: z.string().trim().max(12).optional(),
});

export const personalPasswordSchema = z.object({
  originPassword: z.string().min(1),
  password: z.string().min(1),
});
