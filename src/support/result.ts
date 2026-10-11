/**
 * 与 Java ResultHolder 对齐的响应信封。
 * 成功时 HTTP 200，业务码 100200；前端拦截器只取 data。
 */
export const ResultCode = {
  SUCCESS: 100200,
  VALIDATE_FAILED: 100400,
  UNAUTHORIZED: 100401,
  FORBIDDEN: 100403,
  NOT_FOUND: 100404,
  FAILED: 100500,
} as const;

export interface ResultBody<T = unknown> {
  code: number;
  message: string;
  messageDetail: unknown;
  data: T | null;
}

export function success<T>(data: T, message = 'success'): ResultBody<T> {
  return {
    code: ResultCode.SUCCESS,
    message,
    messageDetail: null,
    data,
  };
}

export function failure(code: number, message: string, messageDetail: unknown = null): ResultBody<null> {
  return {
    code,
    message,
    messageDetail,
    data: null,
  };
}
