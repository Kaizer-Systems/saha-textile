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
	containers: z.object({
		state: partState,
		message: z.string(),
		/** observe.sh `containers` (the Infisical chat's M9). */
		items: z
			.array(
				z.object({
					service: z.string(),
					name: z.string(),
					state: z.string(),
					health: z.string().nullable().default(null),
					restarts: z.number().default(0),
					cpuPercent: z.number().nullable().default(null),
					memBytes: z.number().nullable().default(null),
					memLimitBytes: z.number().nullable().default(null),
				}),
			)
			.default([]),
	}),
	readAt: z.string(),
});
export type ServerState = z.infer<typeof serverStateSchema>;

/** observe.sh `logs <service> [--since <1-60>] [--errors]`: at most 500 lines, masked on the server. */
export const serverLogsSchema = z.object({
	service: z.string(),
	sinceMinutes: z.number(),
	lines: z.array(z.string()),
});
export type ServerLogs = z.infer<typeof serverLogsSchema>;

/**
 * observe.sh `db-report` with the read-only monitor login (Release Path brief Q9, the Infisical
 * chat's 9fda8096): server figures, slow-query shapes (every value "?") and index use.
 */
export const dbReportSchema = z.object({
	uptimeSeconds: z.number().default(0),
	connections: z.unknown(),
	opcounters: z.record(z.string(), z.number()).default({}),
	memoryMB: z.unknown(),
	dataBytes: z.number().default(0),
	storageBytes: z.number().default(0),
	indexBytes: z.number().default(0),
	collections: z.number().default(0),
	slowQueries: z
		.array(
			z.object({
				op: z.string().default(''),
				ns: z.string().default(''),
				millis: z.number().default(0),
				at: z.string().default(''),
				plan: z.string().default(''),
				examined: z.number().default(0),
				returned: z.number().default(0),
				shape: z.string().default(''),
			}),
		)
		.default([]),
	indexes: z
		.array(
			z.object({
				collection: z.string(),
				index: z.string(),
				ops: z.number().default(0),
				since: z.string().default(''),
			}),
		)
		.default([]),
});
export type DbReport = z.infer<typeof dbReportSchema>;
