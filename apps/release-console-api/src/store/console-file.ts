import { z } from 'zod';

import { projectSchema } from '@saha-textile/release-console-contracts';

/**
 * The console's state, kept in its database. It holds projects, key links, the PIN and password
 * hashes and the lock state; key values stay in Infisical.
 */
export const consoleFileSchema = z.object({
	version: z.literal(1),
	workspaces: z.array(z.string()).default([]),
	projects: z.array(projectSchema).default([]),
	pin: z.object({ salt: z.string(), hash: z.string() }).nullable().default(null),
	password: z.object({ salt: z.string(), hash: z.string() }).nullable().default(null),
	preferred: z.enum(['pin', 'password']).default('pin'),
	lock: z
		.object({ failures: z.number().int().nonnegative(), lockedUntil: z.string().nullable() })
		.default({ failures: 0, lockedUntil: null }),
});
export type ConsoleFile = z.infer<typeof consoleFileSchema>;

export const emptyConsoleFile = (): ConsoleFile => ({
	version: 1,
	workspaces: [],
	projects: [],
	pin: null,
	password: null,
	preferred: 'pin',
	lock: { failures: 0, lockedUntil: null },
});
