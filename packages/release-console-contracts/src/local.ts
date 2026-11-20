/**
 * This Mac as a Release Console environment: its own figures, Docker's, the shop's health, jobs the
 * console starts through the Mac helper, and the history the console keeps. Never a secret value.
 */
import { z } from 'zod';

const num = z.number().nullable();

export const macSnapshotSchema = z.object({
	at: z.string(),
	cpu: z.object({ user: z.number(), sys: z.number(), idle: z.number(), used: z.number() }).nullable(),
	memory: z.object({ total: num, used: z.number(), compressed: z.number(), wired: z.number() }),
	swapUsed: z.number(),
	load: z.object({ one: z.number(), five: z.number(), fifteen: z.number() }).nullable(),
	disk: z.object({ total: z.number(), free: z.number(), used: z.number() }).nullable(),
	network: z.object({ rx: z.number(), tx: z.number() }),
	cpus: num,
});
export type MacSnapshot = z.infer<typeof macSnapshotSchema>;

export const containerStatSchema = z.object({
	name: z.string(),
	cpuPercent: num,
	memoryBytes: num,
	memoryLimitBytes: num,
	netRxBytes: num,
	netTxBytes: num,
	blockReadBytes: num,
	blockWriteBytes: num,
	pids: z.number(),
});
export type ContainerStat = z.infer<typeof containerStatSchema>;

export const dockerSnapshotSchema = z.object({
	at: z.string(),
	reachable: z.boolean(),
	version: z.string().nullable(),
	cpus: num,
	memoryTotal: num,
	containers: z.array(
		z.object({ name: z.string(), image: z.string(), state: z.string(), status: z.string(), ports: z.string() }),
	),
	stats: z.array(containerStatSchema),
});
export type DockerSnapshot = z.infer<typeof dockerSnapshotSchema>;

const healthAnswer = z.object({ status: z.number().optional(), body: z.unknown() }).nullable();
export const shopHealthSchema = z.object({
	at: z.string(),
	dev: healthAnswer,
	stack: healthAnswer,
	stackPort: z.number(),
});
export type ShopHealth = z.infer<typeof shopHealthSchema>;

/** Whether the Mac helper answers, and from which checkout. */
export const helperStatusSchema = z.object({
	reachable: z.boolean(),
	root: z.string().nullable(),
	message: z.string(),
	devServers: z.record(z.string(), z.boolean()).nullable(),
});
export type HelperStatus = z.infer<typeof helperStatusSchema>;

export const jobLineSchema = z.object({
	seq: z.number(),
	stream: z.enum(['out', 'err']),
	text: z.string(),
	event: z.record(z.string(), z.unknown()).nullable(),
});
export type JobLine = z.infer<typeof jobLineSchema>;

export const jobSchema = z.object({
	id: z.string(),
	kind: z.enum(['stack', 'pipeline']),
	label: z.string(),
	status: z.enum(['running', 'stopping', 'passed', 'failed', 'stopped']),
	startedAt: z.string(),
	finishedAt: z.string().nullable(),
	exitCode: z.number().nullable(),
	lines: z.array(jobLineSchema),
});
export type Job = z.infer<typeof jobSchema>;
export const jobsSchema = z.array(jobSchema);

export const localActionSchema = z.enum(['stack-env', 'stack-up', 'stack-stop-apps', 'stack-start-apps', 'pipeline']);
export type LocalAction = z.infer<typeof localActionSchema>;
export const PIPELINE_STAGES = ['checks', 'proof', 'images', 'release', 'deploy', 'record'] as const;
export const pipelineStageSchema = z.enum(PIPELINE_STAGES);
export type PipelineStage = z.infer<typeof pipelineStageSchema>;
/** The PIN or the password, asked again for every change. */
const confirmation = z.string().min(6).max(200);
/** Starting a job needs the console PIN (or password) again, as every change does. */
export const startLocalSchema = z.object({
	pin: confirmation,
	from: pipelineStageSchema.optional(),
	only: pipelineStageSchema.optional(),
});
export type StartLocal = z.infer<typeof startLocalSchema>;
export const confirmPinSchema = z.object({ pin: confirmation });

export const logsSchema = z.object({ container: z.string(), lines: z.array(z.string()) });
export type Logs = z.infer<typeof logsSchema>;

/** One figure over time: `[epoch ms, value]` pairs, 5-second points for 2 hours, minute averages after. */
export const seriesSchema = z.object({
	source: z.string(),
	name: z.string(),
	points: z.array(z.tuple([z.number(), z.number()])),
});
export type Series = z.infer<typeof seriesSchema>;
export const seriesListSchema = z.array(seriesSchema);

/* ----- local alerts ----- */

/**
 * The rules the console checks itself, every 5 seconds while it runs, for environments on this
 * computer. A server's own rules come with its agent, which keeps alerting while the Mac is off.
 */
export const ALERT_RULES = [
	'disk',
	'container-down',
	'helper-down',
	'run-failed',
	'key-expiring',
	'errors-rising',
] as const;
export const alertRuleSchema = z.enum(ALERT_RULES);
export type AlertRule = z.infer<typeof alertRuleSchema>;

export const alertSchema = z.object({
	id: z.number().int(),
	rule: alertRuleSchema,
	/** What the alert is about: a container, a run, a key, or the Mac itself. */
	subject: z.string(),
	level: z.enum(['amber', 'red']),
	title: z.string(),
	detail: z.string(),
	firedAt: z.string(),
	resolvedAt: z.string().nullable(),
});
export type Alert = z.infer<typeof alertSchema>;

export const alertRuleStateSchema = z.object({
	rule: alertRuleSchema,
	label: z.string(),
	watches: z.string(),
	firesWhen: z.string(),
	sendsTo: z.string(),
	/** `waiting`: the rule has nothing to read yet (for example, no request log). */
	state: z.enum(['ok', 'firing', 'waiting']),
	note: z.string().nullable(),
});
export type AlertRuleState = z.infer<typeof alertRuleStateSchema>;

export const alertsViewSchema = z.object({
	checkedAt: z.string().nullable(),
	rules: z.array(alertRuleStateSchema),
	firing: z.array(alertSchema),
	/** Alerts that ended in the last 7 days, newest first. */
	recent: z.array(alertSchema),
});
export type AlertsView = z.infer<typeof alertsViewSchema>;
