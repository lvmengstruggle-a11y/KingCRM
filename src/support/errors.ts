import { ResultCode } from './result.js';

/**
 * 业务异常。httpStatus：
 * 未登录 401 / 无权限 403 / 校验 400 / 未分类业务错误 500。
 */
export class AppError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: number,
    message: string,
    readonly messageDetail: unknown = null,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function unauthorized(message = '用户未登录'): AppError {
  return new AppError(401, 401, message);
}

export function forbidden(message = '没有权限'): AppError {
  return new AppError(403, 403, message);
}

export function validateFailed(message: string, detail: unknown = null): AppError {
  return new AppError(400, ResultCode.VALIDATE_FAILED, message, detail);
}

export function notFound(message = '资源不存在'): AppError {
  return new AppError(404, ResultCode.NOT_FOUND, message);
}

export function failed(message: string, detail: unknown = null): AppError {
  return new AppError(500, ResultCode.FAILED, message, detail);
}
