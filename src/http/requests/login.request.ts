import { z } from 'zod';

export const loginRequestSchema = z.object({
  username: z.string().min(1, '用户名不能为空').max(256),
  password: z.string().min(1, '密码不能为空').max(512),
  platform: z.string().min(1, '平台不能为空'),
  authenticate: z.string().optional(),
  loginAddress: z.string().optional(),
});

export const localeRequestSchema = z.object({
  language: z.string().min(1, '语言不能为空').max(32),
});

export type LoginRequestBody = z.infer<typeof loginRequestSchema>;
