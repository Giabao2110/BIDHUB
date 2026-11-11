import type { Response } from 'express';

export class HttpProblem extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export function apiError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message, requestId: res.locals.requestId } });
}
