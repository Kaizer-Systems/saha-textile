import { z } from 'zod';

/** A PIN or password, as every other confirmation takes it. */
const confirmation = z.string().min(6).max(200);

/**
 * Changing passwords and keys (Release Path brief, Part 3, approved 23 Nov). New values are made on
 * the owner's Mac by `pnpm secrets:rotate` (the Infisical chat's script) and written into Infisical;
 * the database, Redis and search values then need a deploy with rotation, which changes them on the
 * server before the switch. The console keeps only names, dates and which values wait for that deploy.
 */

/** The script's value ids (the Infisical chat, 23 Nov). */
export const ROTATE_IDS = [
	'mongo-app',
	'redis',
	'mongo-root',
	'mongo-monitor',
	'search',
	'keyfile',
	'sign-in',
	'csrf',
	'mailbox',
] as const;
export type RotateId = (typeof ROTATE_IDS)[number];

/** Values the database, Redis or search run with: changing one needs a deploy with rotation. */
export const DATA_SERVICE_IDS: readonly RotateId[] = [
	'mongo-app',
	'redis',
	'mongo-root',
	'mongo-monitor',
	'search',
	'keyfile',
];
/** Values kept for 30 days under `<NAME>_PREVIOUS` on a scheduled change (brief Q2). */
export const GRACE_IDS: readonly RotateId[] = ['sign-in', 'csrf', 'mailbox'];
export const GRACE_DAYS = 30;

/** One row of Run › Secrets › Rotate, as the brief draws it (3.1): a row may stand for several ids. */
export interface RotateRow {
	key: string;
	ids: readonly RotateId[];
	label: string;
	/** What happens, on a schedule and after a leak; `tone` colours it. */
	scheduled: string;
	leak: string;
	tone: 'ok' | 'amber';
}
export const ROTATE_ROWS: readonly RotateRow[] = [
	{
		key: 'mongo-app',
		ids: ['mongo-app'],
		label: 'Database app password',
		scheduled: 'no pause',
		leak: 'no pause',
		tone: 'ok',
	},
	{ key: 'redis', ids: ['redis'], label: 'Redis password', scheduled: 'no pause', leak: 'no pause', tone: 'ok' },
	{
		key: 'mongo-root',
		ids: ['mongo-root'],
		label: 'Database administrator password',
		scheduled: 'no pause',
		leak: 'no pause',
		tone: 'ok',
	},
	{
		key: 'mongo-monitor',
		ids: ['mongo-monitor'],
		label: 'Database monitor password',
		scheduled: 'no pause',
		leak: 'no pause',
		tone: 'ok',
	},
	{
		key: 'search',
		ids: ['search'],
		label: 'Search master key',
		scheduled: 'search pauses a few seconds',
		leak: 'search pauses a few seconds',
		tone: 'amber',
	},
	{
		key: 'keyfile',
		ids: ['keyfile'],
		label: 'Database keyfile',
		scheduled: 'used from the next restart',
		leak: 'used from the next restart',
		tone: 'amber',
	},
	{
		key: 'sign-in',
		ids: ['sign-in', 'csrf'],
		label: 'Sign-in keys and CSRF key',
		scheduled: 'old ones kept 30 days · nobody signed out',
		leak: 'everyone signs in again · guest carts are lost',
		tone: 'ok',
	},
	{
		key: 'mailbox',
		ids: ['mailbox'],
		label: 'Mailbox key',
		scheduled: 'old one kept 30 days · no reconnect',
		leak: 'each Gmail mailbox is connected again',
		tone: 'ok',
	},
];

/** What one environment's rotations left behind, as the console records them (names and dates only). */
export const rotationStateSchema = z.object({
	/** Database, Redis and search values changed in Infisical and waiting for a deploy with rotation. */
	pending: z.array(z.enum(ROTATE_IDS)).default([]),
	pendingAt: z.string().nullable().default(null),
	/** When a deploy with rotation was started; a successful run after it clears `pending`. */
	requestedAt: z.string().nullable().default(null),
	/** When values moved to `_PREVIOUS` (a scheduled change), and their names; the reminder counts from here. */
	graceAt: z.string().nullable().default(null),
	graceNames: z.array(z.string()).default([]),
	/** The last change made from the console. */
	lastAt: z.string().nullable().default(null),
	lastChanged: z.array(z.string()).default([]),
});
export type RotationState = z.infer<typeof rotationStateSchema>;
export const emptyRotation = (): RotationState => rotationStateSchema.parse({});

/** Run › Secrets › Rotate for one environment. */
export const rotationViewSchema = z.object({
	environment: z.string(),
	/** The Infisical tier the script rotates, or `null` when this environment has none (this computer). */
	tier: z.enum(['development', 'staging', 'production']).nullable(),
	state: rotationStateSchema,
	/** Days left before the reminder to remove the old keys, or `null` when none are kept. */
	graceDaysLeft: z.number().nullable(),
});
export type RotationView = z.infer<typeof rotationViewSchema>;

/** Make new values (brief 3.1): the PIN and the environment's name typed (brief Q6). */
export const rotateRequestSchema = z.object({
	pin: confirmation,
	confirm: z.string().max(40),
	ids: z.array(z.enum(ROTATE_IDS)).min(1).max(ROTATE_IDS.length),
	/** On a schedule (keep old keys 30 days) or after a leak (drop old keys now). */
	grace: z.boolean(),
});
export type RotateRequest = z.infer<typeof rotateRequestSchema>;

/** Remove the old keys (brief R5): blanks the `_PREVIOUS` names; a normal deploy then carries it. */
export const clearPreviousSchema = z.object({ pin: confirmation });

/** The script's answer, names only (`pnpm secrets:rotate -- <tier> … --json`). */
export const rotateResultSchema = z.object({
	tier: z.string(),
	project: z.string(),
	at: z.string(),
	changed: z.array(z.string()),
	movedToPrevious: z.array(z.string()),
	clearedPrevious: z.array(z.string()),
	needsRotateDeploy: z.boolean(),
});
export type RotateResult = z.infer<typeof rotateResultSchema>;

/** The rows a list of ids covers, in the brief's order. */
export const rotateRowsOf = (ids: readonly string[]): RotateRow[] =>
	ROTATE_ROWS.filter((r) => r.ids.some((i) => ids.includes(i)));

/** The record after a rotate run: data values wait for a deploy, grace values start their 30 days. */
export function afterRotate(state: RotationState, asked: readonly RotateId[], result: RotateResult): RotationState {
	const data = asked.filter((i) => DATA_SERVICE_IDS.includes(i));
	return {
		...state,
		pending: result.needsRotateDeploy ? [...new Set([...state.pending, ...data])] : state.pending,
		pendingAt: result.needsRotateDeploy ? result.at : state.pendingAt,
		graceAt: result.movedToPrevious.length ? result.at : result.clearedPrevious.length ? null : state.graceAt,
		graceNames: result.movedToPrevious.length
			? result.movedToPrevious
			: result.clearedPrevious.length
				? []
				: state.graceNames,
		lastAt: result.at,
		lastChanged: result.changed,
	};
}

/** Whole days left before the old keys should go, or `null` when none are kept. */
export function graceDaysLeft(state: RotationState, now = Date.now()): number | null {
	if (!state.graceAt || !state.graceNames.length) return null;
	return Math.ceil((Date.parse(state.graceAt) + GRACE_DAYS * 86_400_000 - now) / 86_400_000);
}

/** The ids behind the data-service files a refusal names (deploy.sh's names). */
export const DATA_FILE_IDS: Readonly<Record<string, RotateId>> = {
	'mongo-app-password': 'mongo-app',
	'redis-password': 'redis',
	'mongo-root-password': 'mongo-root',
	'mongo-monitor-password': 'mongo-monitor',
	'meilisearch.toml': 'search',
	'mongo-keyfile': 'keyfile',
};
