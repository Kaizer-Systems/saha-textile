import { z } from 'zod';

import { projectSchema } from '@saha-textile/release-console-contracts';

/**
 * The console's file on this computer. It holds projects, key references and the PIN hash;
 * key values are only in the Keychain.
 */
export const consoleFileSchema = z.object({
	version: z.literal(1),
	workspaces: z.array(z.string()).default([]),
	projects: z.array(projectSchema).default([]),
	pin: z.object({ salt: z.string(), hash: z.string() }).nullable().default(null),
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
	lock: { failures: 0, lockedUntil: null },
});
