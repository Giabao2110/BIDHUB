import type { Request } from 'express';
import { HttpProblem } from '../../http/error.js';

export const auctionUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const auctionStatuses = new Set(['DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED']);

function parameter(query: Request['query'], key: string) {
  const value = query[key];
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new HttpProblem(422, 'INVALID_QUERY', `Invalid ${key}`);
  return value;
}

function pageNumber(value: string, defaultValue: number, max: number) {
  if (!value) return defaultValue;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > max) {
    throw new HttpProblem(422, 'INVALID_QUERY', 'Invalid pagination');
  }
  return Number(value);
}

export function pagination(query: Request['query']) {
  return {
    page: pageNumber(parameter(query, 'page'), 1, 2_147_483_647),
    pageSize: pageNumber(parameter(query, 'pageSize'), 20, 50),
  };
}

export function auctionListQuery(query: Request['query']) {
  const term = parameter(query, 'query').trim();
  const categoryId = parameter(query, 'categoryId');
  const status = parameter(query, 'status');
  const sort = parameter(query, 'sort') || 'newest';
  if (term.length > 160 || term.includes('\0') || (categoryId && !auctionUuid.test(categoryId)) ||
      (status && !auctionStatuses.has(status)) || (sort !== 'newest' && sort !== 'endingSoon')) {
    throw new HttpProblem(422, 'INVALID_QUERY', 'Invalid auction filter or sort');
  }
  return {
    term,
    categoryId: categoryId || null,
    status: status || null,
    sort,
    ...pagination(query),
  } as const;
}

export type AuctionListQuery = ReturnType<typeof auctionListQuery>;
