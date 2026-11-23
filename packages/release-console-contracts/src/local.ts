/**
 * This Mac as a Release Console environment: its own figures, Docker's, the shop's health, jobs the
 * console starts through the Mac helper, and the history the console keeps. Never a secret value.
 */
import { z } from 'zod';

import { branchNameSchema } from './projects.js';

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
	kind: z.enum(['stack', 'pipeline', 'github', 'seo']),
	label: z.string(),
	status: z.enum(['running', 'stopping', 'passed', 'failed', 'stopped']),
	startedAt: z.string(),
	finishedAt: z.string().nullable(),
	exitCode: z.number().nullable(),
	lines: z.array(jobLineSchema),
});
export type Job = z.infer<typeof jobSchema>;
export const jobsSchema = z.array(jobSchema);

export const localActionSchema = z.enum([
	'stack-env',
	'stack-up',
	'stack-stop-apps',
	'stack-start-apps',
	'pipeline',
	'tracing-on',
	'tracing-off',
]);
export type LocalAction = z.infer<typeof localActionSchema>;
export const PIPELINE_STAGES = ['checks', 'proof', 'images', 'release', 'deploy', 'record'] as const;
export const pipelineStageSchema = z.enum(PIPELINE_STAGES);
export type PipelineStage = z.infer<typeof pipelineStageSchema>;
/** The PIN or the password, asked again for every change. */
const confirmation = z.string().min(6).max(200);
/** Starting a job needs the console PIN (or password) again, as every change does. */
export const startLocalSchema = z.object({
	pin: confirmation,
	/** The branch this run builds; the checked-out branch when left out (owner, 20 Nov). */
	branch: branchNameSchema.optional(),
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

/* ----- requests (APM from the edge's request log) ----- */

/** Latency buckets of the minute summaries, in milliseconds; the last one has no upper end. */
export const LATENCY_BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2000, 4000, 8000] as const;

const timing = {
	count: z.number().int(),
	perMinute: z.number(),
	p50: num,
	p95: num,
	p99: num,
	/** Server errors (5xx) as a share of requests, 0 to 1. */
	errorRate: z.number(),
	clientErrorRate: z.number(),
	/** 0 to 1: requests under 0.5 s count fully, those under 2 s count half. */
	apdex: num,
};
export const requestServiceSchema = z.object({ service: z.string(), ...timing });
export const requestRouteSchema = z.object({
	service: z.string(),
	method: z.string(),
	route: z.string(),
	...timing,
	/** Request counts per latency bucket, for the endpoint's histogram. */
	buckets: z.array(z.number().int()),
});
export type RequestRoute = z.infer<typeof requestRouteSchema>;

export const requestsViewSchema = z.object({
	/** `edge`: read from the local stack edge's JSON request log; `none`: nothing to read yet. */
	source: z.enum(['edge', 'none']),
	note: z.string().nullable(),
	minutes: z.number().int(),
	readAt: z.string().nullable(),
	services: z.array(requestServiceSchema),
	routes: z.array(requestRouteSchema),
	/** Per minute: [time, p95 ms of all services, server-error share 0 to 1, requests]. */
	series: z.array(z.tuple([z.number(), num, z.number(), z.number()])),
});
export type RequestsView = z.infer<typeof requestsViewSchema>;

/* ----- secrets (names only, from Infisical with the owner's login) ----- */

/**
 * The name list's tiers (docker/infisical/variable-names.json), each its own Infisical project:
 * `local` this computer (saha-textile-local), `development` a development server
 * (saha-textile-development), then staging and production. Each console environment reads only its
 * own place. `dev` was renamed `local` on 2026-11-21.
 */
export const SECRET_TIERS = ['local', 'development', 'staging', 'production'] as const;
export const secretTierSchema = z.enum(SECRET_TIERS);
export type SecretTier = z.infer<typeof secretTierSchema>;
/** `unknown`: Infisical could not read that folder. */
export const secretStateSchema = z.enum(['set', 'empty', 'missing', 'unknown']);
export type SecretState = z.infer<typeof secretStateSchema>;
/** Which environment's Secrets tab to read: the API looks up that environment's own secrets place. */
export const secretsQuerySchema = z.object({
	projectId: z.string().regex(/^[a-z0-9-]+$/),
	repositoryId: z.string().regex(/^[a-z0-9-]+$/),
	environment: z.string().regex(/^[a-z0-9-]+$/),
	fresh: z.string().optional(),
});
export type SecretsQuery = z.infer<typeof secretsQuerySchema>;
export const secretsViewSchema = z.object({
	at: z.string(),
	/**
	 * The name-list tier the place matches (its project and environment are one of the projects in
	 * docker/infisical/variable-names.json), or `null`: then the names are read only, nothing is
	 * expected, so nothing is marked missing and nothing takes a new value.
	 */
	tier: secretTierSchema.nullable(),
	/** The Infisical project and environment read, for example `saha-textile-local` and `dev`. */
	project: z.string(),
	environment: z.string(),
	/** The place's folder: `/` for the whole environment. */
	folder: z.string(),
	folders: z.array(
		z.object({
			folder: z.string(),
			rows: z.array(
				z.object({
					name: z.string(),
					/** Listed in docker/infisical/variable-names.json. */
					expected: z.boolean(),
					devOnly: z.boolean(),
					/** May stay empty: optional, or one of an either-one pair. */
					optional: z.boolean(),
					/** Listed by the inventory for this folder, so it can take a new value. */
					writable: z.boolean(),
					/** A release stops on it while blank (docker/production/required-secrets.txt); /api only. */
					requiredForRelease: z.boolean().default(false),
					/** Tagged `may-deploy-blank`: a server deploy may leave it blank when asked. */
					mayDeployBlank: z.boolean().default(false),
					state: secretStateSchema,
				}),
			),
		}),
	),
	errors: z.array(z.object({ folder: z.string(), message: z.string() })),
});
export type SecretsView = z.infer<typeof secretsViewSchema>;

/** One draft: a new value for a name in a folder of the open tier. Sent in a request body only. */
export const secretChangeSchema = z.object({
	folder: z.string().regex(/^[a-z0-9-]+$/),
	name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
	value: z
		.string()
		.min(1)
		.max(64 * 1024),
});
export type SecretChange = z.infer<typeof secretChangeSchema>;
/**
 * The Save of a batch of drafts (owner, 20 Nov: drafts saved together with one PIN). An environment
 * that runs on a server also needs its name typed in `confirmName`; one on this computer does not.
 */
export const saveSecretsSchema = z.object({
	/** The environment whose Secrets tab holds the drafts; the API looks up its place. */
	projectId: z.string().regex(/^[a-z0-9-]+$/),
	repositoryId: z.string().regex(/^[a-z0-9-]+$/),
	environment: z.string().regex(/^[a-z0-9-]+$/),
	pin: confirmation,
	confirmName: z.string().default(''),
	changes: z.array(secretChangeSchema).min(1).max(200),
});
export type SaveSecrets = z.infer<typeof saveSecretsSchema>;
export const saveSecretsResultSchema = z.object({
	tier: secretTierSchema,
	project: z.string(),
	environment: z.string(),
	results: z.array(
		z.object({ folder: z.string(), names: z.array(z.string()), saved: z.boolean(), error: z.string().nullable() }),
	),
});
export type SaveSecretsResult = z.infer<typeof saveSecretsResultSchema>;

/**
 * The name list's places, for filling in an environment's place in one click: each tier's Infisical
 * project and environment, and the repository (`owner/name`) of the checkout the Mac helper runs in,
 * which is the repository that name list belongs to.
 */
export const secretsPlacesSchema = z.object({
	repository: z.string().nullable(),
	places: z.array(z.object({ tier: secretTierSchema, project: z.string(), environment: z.string() })),
});
export type SecretsPlaces = z.infer<typeof secretsPlacesSchema>;

/** The GitHub CLI on this Mac, as the Mac helper sees it; never its token. */
export const githubStatusSchema = z.object({
	installed: z.boolean(),
	signedIn: z.boolean(),
	account: z.string().nullable(),
});
export type GithubStatus = z.infer<typeof githubStatusSchema>;

/** Connect's check before any terminal opens: signed in, still answering, and able to open the repository. */
export const githubCheckSchema = githubStatusSchema.extend({
	repository: z.string(),
	/** GitHub's own name for it: differs from `repository` after a rename or a move. */
	fullName: z.string().nullable(),
	reachable: z.boolean(),
	message: z.string(),
});
export type GithubCheck = z.infer<typeof githubCheckSchema>;

const githubRepository = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'owner/name');
/** Connect's terminal: which repository it checks in step 4, and whether to add another account. */
export const githubLoginSchema = z.object({
	repository: githubRepository,
	mode: z.enum(['login', 'another']).default('login'),
});
export type GithubLogin = z.infer<typeof githubLoginSchema>;
/** Connect's second way in: a pasted token, passed to gh and never kept by the console. */
export const githubTokenLoginSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_]{20,255}$/, 'a GitHub token') });
export const githubTokenLoginResultSchema = z.object({
	ok: z.boolean(),
	account: z.string().nullable(),
	message: z.string(),
});
export type GithubTokenLoginResult = z.infer<typeof githubTokenLoginResultSchema>;
