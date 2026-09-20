import type { ZodType } from 'zod';
import { ApiError, zodFields } from './errors';

/** Parse-or-422 for request bodies and queries. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw ApiError.unprocessable('Invalid input', zodFields(result.error));
  return result.data;
}
