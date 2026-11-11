import { HttpProblem } from '../../http/error.js';
import { auctionUuid } from './list-query.js';

const fields = new Set([
  'title', 'description', 'categoryId', 'imageUrl', 'openingPriceVnd', 'minimumIncrementVnd', 'startsAt', 'endsAt',
]);
const maxVnd = 9_223_372_036_854_775_807n;

function invalid(field: string): never {
  throw new HttpProblem(422, 'INVALID_INPUT', `Invalid auction ${field}`);
}

export function draftBody(body: unknown) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) invalid('body');
  const keys = Object.keys(body);
  if (!keys.length || keys.some(key => !fields.has(key))) invalid('body fields');
  return body as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string') invalid(field);
  const text = value.trim();
  if (!text || text.length > maxLength || text.includes('\0')) invalid(field);
  return text;
}

function image(value: unknown) {
  if (value === null) return null;
  const text = requiredText(value, 'imageUrl', 2048);
  if (!/^https:\/\//i.test(text) || /[\x00-\x20\x7f]/u.test(text)) invalid('imageUrl');
  const url = URL.parse(text);
  if (!url || url.protocol !== 'https:' || !url.hostname || url.username || url.password) invalid('imageUrl');
  return text;
}

function money(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > maxVnd) invalid(field);
  return value;
}

function instant(value: unknown, field: string) {
  const match = typeof value === 'string'
    ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value)
    : null;
  if (!match) invalid(field);
  const iso = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || iso.startsWith('0000-') || date.toISOString() !== iso) invalid(field);
  return date;
}

export function validateDraft(input: Record<string, unknown>) {
  const title = requiredText(input.title, 'title', 160);
  const description = requiredText(input.description, 'description', 10_000);
  const categoryId = input.categoryId;
  if (typeof categoryId !== 'string' || !auctionUuid.test(categoryId)) invalid('categoryId');
  const imageUrl = image(input.imageUrl === undefined ? null : input.imageUrl);
  const openingPriceVnd = money(input.openingPriceVnd, 'openingPriceVnd');
  const minimumIncrementVnd = money(input.minimumIncrementVnd, 'minimumIncrementVnd');
  const startsAt = instant(input.startsAt, 'startsAt');
  const endsAt = instant(input.endsAt, 'endsAt');
  if (endsAt <= startsAt) invalid('endsAt');
  return { title, description, categoryId, imageUrl, openingPriceVnd, minimumIncrementVnd, startsAt, endsAt };
}
