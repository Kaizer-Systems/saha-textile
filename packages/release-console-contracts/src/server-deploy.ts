import { z } from 'zod';

import { vendorAnswer } from './projects.js';

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
} as const;
export type ServerTarget = keyof typeof SERVER_TARGETS;

/**
 * The deploy target of a console environment that runs on a server, by its name. A development
 * server has none yet: it needs its own deploy identity and API setting first (Infisical chat, 20 Nov).
 */
export function serverTargetOf(environment: string): ServerTarget | null {
	if (/prod/i.test(environment)) return 'production';
	if (/stag/i.test(environment)) return 'staging';
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
		jobs: ['Deploy to'],
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
		jobs: ['Deploy to'],
		steps: ['Install cloudflared', 'Open the way to the server'],
	},
	{
		key: 'deploy',
		label: 'Pull, release steps, switch, health',
		jobs: ['Deploy to'],
		steps: ['Ship the release and deploy it on the server'],
	},
	{ key: 'health', label: 'Health through Cloudflare', jobs: ['Deploy to'], steps: ['Health through Cloudflare'] },
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

export const serverDeployViewSchema = z.object({
	environment: z.string(),
	target: z.enum(['staging', 'production']).nullable(),
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
});
export type ServerDeployView = z.infer<typeof serverDeployViewSchema>;
export const serverDeployAnswerSchema = vendorAnswer(serverDeployViewSchema);

export const startServerDeploySchema = z.object({ pin: confirmation });
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
			const deploy = run.jobs.find((j) => j.name.startsWith('Deploy to'));
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
