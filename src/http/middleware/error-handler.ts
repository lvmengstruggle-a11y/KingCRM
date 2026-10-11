import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { AppError } from '../../support/errors.js';
import { failure, ResultCode } from '../../support/result.js';

function readableIssues(detail: Record<string, string>): Record<string, string> {
  const readable: Record<string, string> = {};
  for (const [field, message] of Object.entries(detail)) {
    readable[field] = message.startsWith('Too small:') || message.startsWith('Invalid input:')
      ? '不能为空'
      : message;
  }
  return readable;
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof ZodError) {
    const detail: Record<string, string> = {};
    for (const issue of error.issues) {
      detail[issue.path.join('.') || 'body'] = issue.message;
    }
    reply.status(400).send(failure(ResultCode.VALIDATE_FAILED, '参数校验失败', readableIssues(detail)));
    return;
  }

  if (error instanceof AppError) {
    if (error.httpStatus === 401) {
      reply.header('Authentication-Status', 'invalid');
    }
    reply.status(error.httpStatus).send(failure(error.code, error.message, error.messageDetail));
    return;
  }

  request.log.error({ err: error }, 'unhandled error');
  reply.status(500).send(failure(ResultCode.FAILED, '服务器内部错误'));
}
