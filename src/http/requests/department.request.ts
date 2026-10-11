import { z } from 'zod';

export const departmentAddSchema = z.object({
  name: z.string().trim().min(1, '部门名称不能为空').max(255),
  parentId: z.string().trim().min(1, '上级部门不能为空'),
});

export const departmentRenameSchema = z.object({
  id: z.string().trim().min(1, '部门不能为空'),
  name: z.string().trim().min(1, '部门名称不能为空').max(255),
});

export const departmentCommanderSchema = z.object({
  departmentId: z.string().trim().min(1, '部门不能为空'),
  commanderId: z.string().trim().min(1, '负责人不能为空'),
});

export const departmentIdsSchema = z.array(z.string().trim().min(1)).min(1, '部门不能为空');

export const departmentSortSchema = z.object({
  dragNodeId: z.string().trim().min(1, '被拖拽的节点不能为空'),
  dropNodeId: z.string().trim().min(1, '目标节点不能为空'),
  dropPosition: z.number().int(),
});
