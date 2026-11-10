import { BadRequestException } from '@nestjs/common';

import type { z } from 'zod';

/** Parses a request body with a shared contract; a bad body is a 400 that names the fields, never echoes values. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
	const result = schema.safeParse(body);
	if (!result.success)
		throw new BadRequestException(
			result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
		);
	return result.data;
}
