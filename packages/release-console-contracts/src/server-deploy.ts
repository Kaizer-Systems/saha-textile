import { z } from 'zod';

import { branchNameSchema, vendorAnswer } from './projects.js';

/** A PIN or password, as every other confirmation in local.ts takes it. */
const confirmation = z.string().min(6).max(200);

/**
 * Server deploys (owner, 20 Nov: "this computer" runs the local pipeline; a server environment runs
 * the server workflow). The console starts `.github/workflows/deploy.yml` with the owner's PIN on
 * the branch the GitHub environment allows, then follows that run's jobs and steps.
 */
export const DEPLOY_WORKFLOW = 'deploy.yml';

/** The GitHub environments deploy.yml deploys to, with the branch each one allows. */
export const SERVER_TARGETS = {
	staging: { branch: 'staging' },
	production: { branch: 'main' },
	/** A development server may run any branch, picked on its Live deploy tab (owner, 21 Nov). */
	development: { branch: 'dev' },
} as const;
/** The targets whose branch can be picked for one run on the deploy screen; the others are locked. */
export const BRANCH_PICKED_TARGETS: readonly ServerTarget[] = ['development'];
export type ServerTarget = keyof typeof SERVER_TARGETS;

/** The deploy target of a console environment that runs on a server, by its name. */
export function serverTargetOf(environment: string): ServerTarget | null {
	if (/prod/i.test(environment)) return 'production';
	if (/stag/i.test(environment)) return 'staging';
	if (/dev/i.test(environment)) return 'development';
	return null;
}

/** What a GitHub environment must hold before deploy.yml can deploy to it (deploy.yml's header). */
export const DEPLOY_VARIABLES = [
	'INFISICAL_IDENTITY_ID',
	'SERVER_SSH_HOST',
	'SERVER_SSH_KNOWN_HOSTS',
	'API_HOST',
] as const;
export const DEPLOY_SECRETS = ['DEPLOY_SSH_KEY', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET'] as const;

/**
 * The run's lane, in the brief's Live deploy order. Each row names the deploy.yml jobs (by name
 * prefix) and, for the deploy job, the steps it stands for; a test keeps these names in step with
 * deploy.yml.
 */
export const SERVER_LANE = [
	{ key: 'checks', label: 'Checks (CI)', jobs: ['Publish / CI'], steps: [] },
	{ key: 'proof', label: 'Production proof', jobs: ['Publish / Production stack proof'], steps: [] },
	{
		key: 'images',
		label: 'Images in GHCR',
		jobs: ['Images for this commit', 'Publish / Publish', 'Image digests'],
		steps: [],
	},
	{ key: 'approval', label: 'Your approval', jobs: [], steps: [] },
	{
		key: 'release',
		label: 'Release folder from Infisical',
		jobs: ['Deploy to', 'Roll back'],
		steps: [
			'Check this environment is set up',
			'Install the Infisical CLI',
			"Sign in to Infisical as this environment's deploy identity",
			'Write the release folder',
			'Check the release folder',
		],
	},
	{
		key: 'login',
		label: 'Sign in to the server',
		jobs: ['Deploy to', 'Roll back'],
		steps: ['Install cloudflared', 'Open the way to the server'],
	},
	{
		key: 'deploy',
		label: 'Pull, release steps, switch, health',
		jobs: ['Deploy to', 'Roll back'],
		// A rollback swaps the previous release back in instead (Release Path brief F16).
		steps: ['Ship the release and deploy it on the server', 'Roll back on the server'],
	},
	{
		key: 'health',
		label: 'Health through Cloudflare',
		jobs: ['Deploy to', 'Roll back'],
		steps: ['Health through Cloudflare'],
	},
] as const;

const stepSchema = z.object({
	name: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
	startedAt: z.string().nullable(),
	completedAt: z.string().nullable(),
});
export const deployJobSchema = stepSchema.extend({ steps: z.array(stepSchema) });
export type DeployJob = z.infer<typeof deployJobSchema>;

export const deployRunSchema = z.object({
	id: z.number(),
	url: z.string(),
	branch: z.string(),
	commit: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
	createdAt: z.string(),
	/** Waiting for the owner's approval of the deploy job; the ids of the environments it waits on. */
	waiting: z.array(z.number()),
	jobs: z.array(deployJobSchema),
});
export type DeployRun = z.infer<typeof deployRunSchema>;

/**
 * Why a deploy did not go live, read from the deploy job's log (Release Path brief, paths F8/R2 and
 * F12): a release step that failed with its message, the server's refusal of changed data-service
 * secrets with their names, or the server's own "FAILED:" line.
 */
export const deployFailureSchema = z.object({
	kind: z.enum(['release-step', 'refused-secrets', 'stopped']),
	/** The release step's label (roles, indexes, migrations, search), for a failed release step. */
	step: z.string().nullable(),
	message: z.string(),
	/** The data-service secrets the server refused, for a refusal. */
	names: z.array(z.string()),
});
export type DeployFailure = z.infer<typeof deployFailureSchema>;

/** The data-service secret files deploy.sh compares, in the words the console shows. */
export const DATA_SECRET_LABELS: Readonly<Record<string, string>> = {
	'mongo-keyfile': 'database keyfile',
	'mongo-root-username': 'database administrator name',
	'mongo-root-password': 'database administrator password',
	'mongo-app-password': 'database app password',
	'redis-password': 'Redis password',
	'meilisearch.toml': 'search master key',
};

/** A GitHub log line without its timestamp. */
const bareLine = (line: string) => line.replace(/^\uFEFF?\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, '').trimEnd();

/**
 * Reads the deploy job's log for why it stopped. deploy.sh's refusal names the secrets after
 * "already run with:" (its wording after the names may change; the Infisical chat, 23 Nov); the
 * release steps print "✗ <step>: <message>"; deploy.sh's own stops print "FAILED: <message>".
 */
export function deployFailureOf(lines: readonly string[]): DeployFailure | null {
	const clean = lines.map(bareLine);
	const refused = clean.find((l) => l.includes('already run with:'));
	if (refused) {
		const after = refused.slice(refused.indexOf('already run with:') + 'already run with:'.length);
		const names = (after.split('.')[0] ?? '')
			.split(/,\s*|\s+and\s+/)
			.map((n) => n.trim())
			.filter((n) => /^[\w.-]+$/.test(n));
		return {
			kind: 'refused-secrets',
			step: null,
			message: refused.replace(/^FAILED:\s*/, ''),
			names,
		};
	}
	const step = [...clean].reverse().find((l) => /^✗ [^:]+: /.test(l));
	if (step) {
		const m = /^✗ ([^:]+): (.*?)(?: \(\d+ ms\))?$/.exec(step);
		return { kind: 'release-step', step: m?.[1] ?? null, message: m?.[2] ?? step, names: [] };
	}
	const stop = [...clean].reverse().find((l) => l.startsWith('FAILED: '));
	return stop ? { kind: 'stopped', step: null, message: stop.slice('FAILED: '.length), names: [] } : null;
}

/** A release tag deploy.yml pushes after a healthy deploy: `<environment>-<yyyymmdd-hhmmss>-<sha8>`. */
export const RELEASE_TAG = /^(staging|production|development)-(\d{8})-(\d{6})-([0-9a-f]{8})$/;
export const releaseTagSchema = z.object({ name: z.string(), commit: z.string(), at: z.string() });
export type ReleaseTag = z.infer<typeof releaseTagSchema>;

/** The tag's own date and time (UTC), as an ISO string, or `null` for another tag. */
export function releaseTagTime(name: string): string | null {
	const m = RELEASE_TAG.exec(name);
	if (!m) return null;
	const [d, t] = [m[2] ?? '', m[3] ?? ''];
	return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
}

export const serverDeployViewSchema = z.object({
	environment: z.string(),
	target: z.enum(['staging', 'production', 'development']).nullable(),
	branch: z.string().nullable(),
	/** Whether the GitHub environment exists, and the names it still lacks (`null` when the key cannot list them). */
	setup: z.object({
		environmentExists: z.boolean(),
		missingVariables: z.array(z.string()).nullable(),
		missingSecrets: z.array(z.string()).nullable(),
		workflowOnBranch: z.boolean(),
	}),
	run: deployRunSchema.nullable(),
	recent: z.array(deployRunSchema.omit({ jobs: true, waiting: true })),
	/** Why the newest run did not go live, when it failed (read from its deploy job's log). */
	failure: deployFailureSchema.nullable().default(null),
	/** This environment's release tags, newest first (Deploy an older version). */
	tags: z.array(releaseTagSchema).default([]),
});
export type ServerDeployView = z.infer<typeof serverDeployViewSchema>;
export const serverDeployAnswerSchema = vendorAnswer(serverDeployViewSchema);

/**
 * /api names a server deploy never accepts blank, with what would happen (brief 26gq3NbcbBESea6abRtsa3,
 * screen 12: "the database and Redis passwords never are"). The database, Redis, search and the API's
 * own start-up settings: without them the server does not come up at all, so allowing them blank
 * would only start a deploy that fails. deploy.yml checks the same rule (a test keeps them in step).
 */
export const NEVER_BLANK_PATTERN =
	'^(MONGODB_|REDIS_|MEILISEARCH_)|^(NODE_ENV|DEPLOY_ENV|PORT|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|CSRF_SECRET|COOKIE_SECURE|CORS_ALLOWED_ORIGINS|TRUST_PROXY)$';
const NEVER_BLANK = new RegExp(NEVER_BLANK_PATTERN);

/**
 * Which values a server deploy may leave blank is a positive list: the `may-deploy-blank` tag in
 * docker/production/required-secrets.txt (Infisical chat, 21 Nov), read by the Mac helper into each
 * Secrets row. The pattern above stays as a first gate. Some tagged values go together: the API
 * refuses a media store with only some of its keys (scripts/secrets/render.mjs), so they are
 * allowed blank all at once or not at all.
 */
export const BLANK_TOGETHER: readonly (readonly string[])[] = [['SPACES_KEY', 'SPACES_SECRET', 'SPACES_BUCKET']];

/** Why a name can never be deployed blank, or `null` when it can be allowed. */
export function neverBlankReason(name: string): string | null {
	if (!NEVER_BLANK.test(name)) return null;
	if (name.startsWith('MONGODB_')) return 'the database will not start';
	if (name.startsWith('REDIS_')) return 'Redis will not start';
	if (name.startsWith('MEILISEARCH_')) return 'search will not start';
	return 'the API will not start';
}

/**
 * A server deploy runs on its environment's own branch (owner, 20 Nov: server branches are frozen
 * on the deploy screen and change only in the wizard or Project settings › Repositories).
 */
export const startServerDeploySchema = z
	.object({
		pin: confirmation,
		/**
		 * Required values the owner lets this deploy run without (brief 26gq3NbcbBESea6abRtsa3, screen 12):
		 * passed to deploy.yml as `allow_blank`, then to the release step as `--allow-blank NAME` each.
		 */
		allowBlank: z
			.array(
				z
					.string()
					.regex(/^[A-Z][A-Z0-9_]{1,63}$/)
					.refine((n) => neverBlankReason(n) === null, {
						message: 'This value can never be deployed blank.',
					}),
			)
			.max(60)
			.default([]),
		/** Production with blanks asks for its name typed. */
		confirm: z.string().max(40).optional(),
		/** A development server only: this run's branch, picked on the deploy tab (owner, 21 Nov). */
		branch: branchNameSchema.optional(),
		/**
		 * Apply changed database, Redis and search secrets on the server before the switch (Release Path
		 * brief 3.2, deploy.yml input `rotate`). Asks for the environment's name typed (brief Q6).
		 */
		rotate: z.boolean().default(false),
		/** With `rotate` only: restart the database now for a new keyfile (about 20 s), else at its next restart. */
		restartDatabase: z.boolean().default(false),
		/** `rollback` swaps the previous release back in on the server, from images on its disk (brief F16). */
		action: z.enum(['deploy', 'rollback']).default('deploy'),
		/** Deploy an older version: one of this environment's release tags instead of its branch. */
		tag: z.string().regex(RELEASE_TAG).optional(),
	})
	.refine((b) => !b.restartDatabase || b.rotate, {
		message: 'Restarting the database goes only with rotation.',
		path: ['restartDatabase'],
	})
	.refine((b) => b.action === 'deploy' || (!b.rotate && !b.tag && !b.allowBlank.length), {
		message: 'A rollback only swaps the previous release back in.',
		path: ['action'],
	})
	.refine((b) => !(b.tag && b.branch), { message: 'Pick a version or a branch, not both.', path: ['tag'] });
export type StartServerDeploy = z.infer<typeof startServerDeploySchema>;
export const reviewServerDeploySchema = z.object({
	pin: confirmation,
	runId: z.number().int().positive(),
	approve: z.boolean(),
});
export type ReviewServerDeploy = z.infer<typeof reviewServerDeploySchema>;

/** One lane row's state from a run, as the brief draws it. */
export interface LaneRow {
	key: string;
	label: string;
	cls: 'ok' | 'red' | 'run' | 'wait' | 'skip';
	time: string;
}

const seconds = (a: string | null, b: string | null) =>
	a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null;
const took = (s: number | null) => (s === null ? '' : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

/** The lane for a run (or no run yet): each row from its jobs or steps. */
export function serverLane(run: DeployRun | null): LaneRow[] {
	return SERVER_LANE.map((row) => {
		const base = { key: row.key, label: row.label };
		if (!run) return { ...base, cls: 'wait', time: '' };
		if (row.key === 'approval') {
			const deploy = run.jobs.find((j) => j.name.startsWith('Deploy to') || j.name.startsWith('Roll back'));
			if (run.waiting.length) return { ...base, cls: 'run', time: 'waiting for you' };
			if (deploy && deploy.status !== 'queued' && deploy.status !== 'waiting')
				return { ...base, cls: 'ok', time: 'approved' };
			if (run.status === 'completed') return { ...base, cls: 'skip', time: 'not reached' };
			return { ...base, cls: 'wait', time: '' };
		}
		let jobs = run.jobs.filter((j) => row.jobs.some((p) => j.name.startsWith(p)));
		// When this run published the images, their time is the publishing, not the lookup before CI.
		if (row.key === 'images' && jobs.some((j) => j.name.startsWith('Publish / Publish')))
			jobs = jobs.filter((j) => j.name !== 'Images for this commit');
		const parts = row.steps.length
			? jobs.flatMap((j) => j.steps.filter((s) => (row.steps as readonly string[]).includes(s.name)))
			: jobs;
		if (!parts.length) {
			const skipped = row.key === 'checks' || row.key === 'proof';
			const imagesJob = run.jobs.find((j) => j.name === 'Images for this commit');
			if (skipped && imagesJob?.conclusion === 'success' && run.jobs.every((j) => !j.name.startsWith('Publish')))
				return { ...base, cls: 'skip', time: 'images already published' };
			return {
				...base,
				cls: run.status === 'completed' ? 'skip' : 'wait',
				time: run.status === 'completed' ? 'not reached' : '',
			};
		}
		if (parts.some((p) => p.conclusion === 'failure' || p.conclusion === 'cancelled'))
			return {
				...base,
				cls: 'red',
				time: parts.some((p) => p.conclusion === 'cancelled') ? 'cancelled' : 'failed',
			};
		if (parts.every((p) => p.conclusion === 'skipped')) return { ...base, cls: 'skip', time: 'skipped' };
		if (parts.every((p) => p.status === 'completed')) {
			const starts = parts
				.map((p) => p.startedAt)
				.filter((x): x is string => !!x)
				.sort();
			const ends = parts
				.map((p) => p.completedAt)
				.filter((x): x is string => !!x)
				.sort();
			return { ...base, cls: 'ok', time: took(seconds(starts[0] ?? null, ends.at(-1) ?? null)) };
		}
		if (parts.some((p) => p.status === 'in_progress' || p.status === 'completed'))
			return { ...base, cls: 'run', time: 'running…' };
		return { ...base, cls: 'wait', time: '' };
	});
}
