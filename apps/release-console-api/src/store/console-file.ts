import { z } from 'zod';

import { projectSchema, rotationStateSchema } from '@saha-textile/release-console-contracts';

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
	/**
	 * Which environment a cloud resource belongs to, set by the owner (owner, 23 Nov): per
	 * `project/repository`, a resource key (`do:droplet:<id>`, `do:database:<id>`, `do:spaces:<bucket>`,
	 * `do:k8s:<id>`, `do:app:<id>`) → one of that repository's environment names.
	 */
	envTags: z.record(z.string(), z.record(z.string(), z.string())).default({}),
	/**
	 * Per `project/repository`, per environment: what secret rotations left behind (Release Path brief,
	 * Part 3): values waiting for a deploy with rotation, old keys kept 30 days, the last change. Names
	 * and dates only; the values live in Infisical.
	 */
	rotations: z.record(z.string(), z.record(z.string(), rotationStateSchema)).default({}),
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
	envTags: {},
	rotations: {},
});
