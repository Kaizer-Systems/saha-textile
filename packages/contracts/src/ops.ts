import { z } from 'zod';

/**
 * The API's read-only operations address (`/ops`), read by the Release Console with its own key
 * (brief 26gq3NbcbBESea6abRtsa3, Q1 A): counts and statuses only, never a person's details, a
 * message's text, a destination or a job's data.
 */
export const OpsQueue = z.object({
	queue: z.string(),
	waiting: z.number().int(),
	active: z.number().int(),
	delayed: z.number().int(),
	failed: z.number().int(),
	completed: z.number().int(),
});
export const OpsJobs = z.object({ at: z.string(), queues: z.array(OpsQueue) });
export type OpsJobs = z.infer<typeof OpsJobs>;

export const OpsMessagesQuery = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) });
export const OpsMessages = z.object({
	at: z.string(),
	since: z.string(),
	/** Per channel: how many were sent, delivered, failed, held back (suppressed) or still queued. */
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
	/** The newest messages: when, which channel and template, and how it ended. No destination. */
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
export type OpsMessages = z.infer<typeof OpsMessages>;
