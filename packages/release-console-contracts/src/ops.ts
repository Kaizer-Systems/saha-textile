import { z } from 'zod';

import { vendorAnswer } from './projects.js';

/**
 * The shop API's read-only operations address (`/ops`), as the console reads it (brief
 * 26gq3NbcbBESea6abRtsa3, Q1 A): Jobs and queues (screen 8) and Messages (screen 3). Counts and
 * statuses only. Mirrors `packages/contracts/src/ops.ts`; this is the console's own boundary check.
 */
export const opsJobsSchema = z.object({
	at: z.string(),
	queues: z.array(
		z.object({
			queue: z.string(),
			waiting: z.number().int(),
			active: z.number().int(),
			delayed: z.number().int(),
			failed: z.number().int(),
			completed: z.number().int(),
		}),
	),
});
export type OpsJobsView = z.infer<typeof opsJobsSchema>;
export const opsJobsAnswerSchema = vendorAnswer(opsJobsSchema);

export const opsMessagesSchema = z.object({
	at: z.string(),
	since: z.string(),
	channels: z.array(
		z.object({
			channel: z.string(),
			total: z.number().int(),
			sent: z.number().int(),
			delivered: z.number().int(),
			failed: z.number().int(),
			suppressed: z.number().int(),
			queued: z.number().int(),
		}),
	),
	recent: z.array(
		z.object({
			at: z.string(),
			channel: z.string(),
			category: z.string(),
			template: z.string(),
			status: z.string(),
		}),
	),
});
export type OpsMessagesView = z.infer<typeof opsMessagesSchema>;
export const opsMessagesAnswerSchema = vendorAnswer(opsMessagesSchema);

/**
 * Which console key reads an environment's `/ops`: this computer's stack has its own (it reads the
 * saha-textile-local project), a development server reads development's (owner, 21 Nov).
 */
export function opsKeyName(env: { name: string; cloudId: string | null }): string | null {
	if (env.cloudId === null) return 'CONSOLE_OPS_TOKEN_LOCAL';
	if (/dev/i.test(env.name)) return 'CONSOLE_OPS_TOKEN_DEV';
	if (/stag/i.test(env.name)) return 'CONSOLE_OPS_TOKEN_STAGING';
	if (/prod/i.test(env.name)) return 'CONSOLE_OPS_TOKEN_PRODUCTION';
	return null;
}

/**
 * A server environment's live state for Run › Server, Infrastructure, Live logs and Watch (Release
 * Path brief Part 7, C12): machine figures from DigitalOcean's monitoring, the shop's own state from
 * the API's /ops address, containers and logs through the read-only observer login (once a server
 * has it). Each part says why when it cannot be read.
 */
const partState = z.enum(['ok', 'none', 'error', 'waiting']);
export const serverStateSchema = z.object({
	environment: z.string(),
	machine: z.object({
		state: partState,
		message: z.string(),
		cpuPercent: z.number().nullable(),
		memoryPercent: z.number().nullable(),
		diskPercent: z.number().nullable(),
	}),
	shop: z.object({
		state: partState,
		message: z.string(),
		queues: opsJobsSchema.shape.queues,
	}),
	containers: z.object({ state: partState, message: z.string() }),
	readAt: z.string(),
});
export type ServerState = z.infer<typeof serverStateSchema>;
