import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	approvalsScreen,
	calendarScreen,
	impactScreen,
	loadTestScreen,
	logsScreen,
	pipelineScreen,
	pullsScreen,
	rehearsalScreen,
	rollbackScreen,
	stepsScreen,
} from './ship.js';

import type { ProductCtx, ProductScreen } from './kit.js';

/** Server deploys and load runs answer locally. */
const deploys = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('../vendors/github-deploys.js', async (original) => ({
	...(await original<typeof import('../vendors/github-deploys.js')>()),
	startServerDeploy: async (...args: unknown[]) => {
		deploys.calls.push(args);
	},
}));
/** The production backup the rehearsal restores: ready when a test says so. */
const backup = vi.hoisted(() => ({ ready: false }));
vi.mock('./production-backup.js', () => ({
	productionBackup: async () => ({ ready: backup.ready, detail: backup.ready ? 'last night, 02:00' : 'none yet' }),
}));
vi.mock('./loadtest.js', async (original) => ({
	...(await original<typeof import('./loadtest.js')>()),
	runLoad: async () => ({ requests: 40, errors: 1, p50: 120, p95: 480 }),
}));

const SCREENS: Record<string, ProductScreen> = {
	pullsScreen,
	pipelineScreen,
	logsScreen,
	approvalsScreen,
	stepsScreen,
	impactScreen,
	rollbackScreen,
	calendarScreen,
	rehearsalScreen,
	loadTestScreen,
};

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const TAG = 'production-20261123-142210-08ac015c';
const run = (id: number, over: Record<string, unknown>) => ({
	id,
	run_number: id - 100,
	name: 'Deploy',
	head_branch: 'main',
	head_sha: 'abc',
	status: 'completed',
	conclusion: 'success',
	event: 'workflow_dispatch',
	created_at: iso(NOW - 3_600_000),
	updated_at: iso(NOW - 3_000_000),
	run_started_at: iso(NOW - 3_600_000),
	html_url: 'https://github.example.test/run',
	...over,
});
const RUN_OK = run(101, { display_title: 'Deploy staging 08ac015c' });
const RUN_BAD = run(102, { name: 'CI', head_branch: 'dev', head_sha: 'def', conclusion: 'failure' });
const RUN_LIVE = run(103, { status: 'in_progress', conclusion: null });
const RUN_WAIT = run(104, { status: 'waiting', conclusion: null, display_title: 'Release to production' });
const STEPS = [
	{
		number: 1,
		name: 'Checkout',
		status: 'completed',
		conclusion: 'success',
		started_at: iso(NOW - 60_000),
		completed_at: iso(NOW - 50_000),
	},
	{
		number: 2,
		name: 'Release check',
		status: 'completed',
		conclusion: 'failure',
		started_at: iso(NOW - 50_000),
		completed_at: iso(NOW - 40_000),
	},
	{ number: 3, name: 'Test', status: 'in_progress', conclusion: null },
	{ number: 4, name: 'Switch', status: 'queued', conclusion: null },
];
const JOBS = {
	jobs: [
		{ id: 201, name: 'build', status: 'completed', conclusion: 'failure', steps: STEPS },
		{ id: 202, name: 'deploy', status: 'in_progress', conclusion: null, steps: [] },
		{ id: 203, name: 'lint', status: 'completed', conclusion: 'success', steps: [] },
		{
			id: 205,
			name: 'odd',
			status: '',
			conclusion: '',
			steps: [{ number: 1, name: 'Wait', status: '', conclusion: '' }],
		},
	],
};
let log = '';
const LOGS = {
	refused:
		'FAILED: The server keeps the old values: DATABASE_URL, REDIS_URL and MEILI_KEY already run with: DATABASE_URL, REDIS_URL and MEILI_KEY.',
	step: '✗ Migrate: duplicate key (120 ms)',
	stopped: 'FAILED: disk full',
	none: 'nothing to see',
};
const LOG = [
	'2026-11-24T10:00:00.0000000Z Starting',
	'2026-11-24T10:00:01.0000000Z ##[error] Release refused: DATABASE_URL, REDIS_URL differ',
	'',
	'2026-11-24T10:00:02.0000000Z done',
].join('\n');
const DEPLOYMENTS = [
	{
		id: 401,
		environment: 'production',
		sha: 'old',
		ref: TAG,
		created_at: iso(NOW - 7_200_000),
		description: 'release',
	},
	{
		id: 402,
		environment: 'staging',
		sha: 'abc',
		ref: 'staging-20261124-090000-abc12345',
		created_at: iso(NOW - 1_800_000),
	},
	{ id: 403, environment: 'production', sha: 'abc', ref: 'main', created_at: iso(NOW - 86_400_000 * 40) },
	{ id: 404, environment: 'preview', sha: 'abc', ref: 'main', created_at: iso(NOW - 3_600_000) },
	{ id: 405, environment: '', sha: 'abc', ref: 'main', created_at: iso(NOW - 3_600_000) },
	{ id: 406, environment: 'staging', sha: 'abc', ref: 'dev', created_at: iso(NOW + 2 * 86_400_000) },
];

/** Every GitHub address ship.ts reads, answered from one busy repository. */
const BUSY: Array<[RegExp, number, unknown]> = [
	[/\/actions\/runs\?per_page=15/, 200, { workflow_runs: [RUN_OK, RUN_BAD, RUN_LIVE] }],
	[/\/actions\/jobs\/\d+\/logs/, 200, () => `${LOG}\n${log}`],
	[/\/actions\/jobs\/\d+/, 200, JOBS.jobs[0]],
	[
		/\/actions\/runs\/103\/jobs/,
		200,
		{
			jobs: [
				{
					id: 206,
					name: 'deploy',
					status: 'in_progress',
					steps: [{ number: 1, name: 'Checkout', status: 'completed', conclusion: 'success' }],
				},
			],
		},
	],
	[/\/actions\/runs\/\d+\/jobs/, 200, JOBS],
	[
		/\/actions\/runs\/104\/pending_deployments/,
		200,
		[{ environment: { name: 'production' }, current_user_can_approve: true }],
	],
	[/\/actions\/runs\/\d+\/pending_deployments/, 200, []],
	[/\/actions\/runs\?status=failure/, 200, { workflow_runs: [RUN_BAD] }],
	[/\/actions\/runs\?status=waiting/, 200, { workflow_runs: [RUN_WAIT] }],
	[/\/actions\/workflows\/[^/]+\.yml\/runs/, 200, { workflow_runs: [RUN_LIVE, RUN_OK, RUN_BAD] }],
	[/\/actions\/workflows\/1$/, 200, { id: 1, name: 'Deploy', path: '.github/workflows/deploy.yml' }],
	[/\/actions\/workflows\/2$/, 200, { id: 2, name: 'CI', path: '.github/workflows/ci.yml' }],
	[
		/\/actions\/workflows\?/,
		200,
		{
			workflows: [
				{ id: 1, name: 'Deploy', path: '.github/workflows/deploy.yml', state: 'active' },
				{ id: 2, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' },
			],
		},
	],
	[/\/branches/, 200, [{ name: 'main' }, { name: 'dev' }]],
	[
		/\/commits\/abc\/check-runs/,
		200,
		{
			check_runs: [
				{ id: 301, name: 'lint', status: 'completed', conclusion: 'success', app: { slug: 'github-actions' } },
				{ id: 302, name: 'test', status: 'in_progress', conclusion: null, app: { slug: 'github-actions' } },
				{ id: 304, name: 'preview', status: 'completed', conclusion: 'success', app: { slug: 'vercel' } },
			],
		},
	],
	[
		/\/commits\/def\/check-runs/,
		200,
		{
			check_runs: [
				{ id: 303, name: 'test', status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' } },
			],
		},
	],
	[
		/\/pulls\/\d+\/commits/,
		200,
		[
			{ sha: 'abc', commit: { message: 'feat: sarees\n\nbody', author: { name: 'Owner', date: iso(NOW) } } },
			{ sha: 'aaa', commit: { message: '', author: { name: 'Owner', date: iso(NOW) } } },
		],
	],
	[
		/\/pulls\/\d+$/,
		200,
		{
			number: 7,
			title: 'Sarees',
			body: '',
			mergeable_state: 'clean',
			additions: 10,
			deletions: 2,
			changed_files: 3,
			head: { sha: 'abc' },
			base: { ref: 'dev' },
		},
	],
	[
		/\/pulls\?state=open/,
		200,
		[
			{ number: 7, title: 'Sarees', head: { sha: 'abc', ref: 'feat/sarees' }, user: { login: 'owner' } },
			{ number: 8, title: 'Broken', head: { sha: 'def', ref: 'fix/x' }, user: { login: 'owner' } },
		],
	],
	[/\/deployments\?environment=/, 200, [DEPLOYMENTS[0]]],
	[/\/deployments\/401\/statuses/, 200, [{ state: 'success' }]],
	[/\/deployments\/402\/statuses/, 200, [{ state: 'failure' }]],
	[/\/deployments\/\d+\/statuses/, 200, [{ state: 'in_progress' }]],
	[/\/deployments/, 200, DEPLOYMENTS],
	[
		/\/compare\//,
		200,
		{
			ahead_by: 2,
			commits: [{ sha: 'abc', commit: { message: 'fix: y\nmore' } }],
			files: [{ filename: 'apps/api/src/migrations/0003-x.ts' }],
		},
	],
	[
		/\/contents\/apps\/api/,
		200,
		[
			{ name: '0001-first.ts', path: 'apps/api/src/migrations/0001-first.ts', type: 'file', sha: 's1' },
			{ name: 'helpers', path: 'apps/api/src/migrations/helpers', type: 'dir' },
		],
	],
	[/\/contents\//, 404, { message: 'Not Found' }],
	[
		/\/tags/,
		200,
		[
			{ name: TAG, commit: { sha: 'abc' } },
			{ name: 'staging-20261124-090000-abc12345', commit: { sha: 'abc' } },
			{ name: 'v1.0.0', commit: { sha: 'zzz' } },
		],
	],
	[/^(POST|PUT|PATCH|DELETE) /, 204, null],
];
/** A quiet repository: nothing open, nothing running, nothing deployed. */
const QUIET: Array<[RegExp, number, unknown]> = [
	[/\/actions\/runs|\/actions\/workflows\/[^/]+\.yml\/runs/, 200, { workflow_runs: [] }],
	[/\/actions\/workflows\?/, 200, { workflows: [] }],
	[/\/(pulls|branches|deployments|tags)/, 200, []],
	[/\/contents\//, 404, {}],
];

let world = BUSY;
vi.stubGlobal(
	'fetch',
	vi.fn(async (url: string, init?: RequestInit) => {
		const line = `${init?.method ?? 'GET'} ${String(url)}`;
		const hit = world.find(([re]) => re.test(line));
		const status = hit?.[1] ?? 404;
		if (status === 204) return new Response(null, { status });
		const answer = hit?.[2] ?? { message: 'Not Found' };
		const body = typeof answer === 'function' ? (answer as () => string)() : answer;
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
	}),
);

/** Local releases the impact tab compares around: errors rose, nothing changed, and no traffic at all. */
const minute = (ms: number) => Math.floor(ms / 60_000) * 60_000;
const MOMENTS = [
	{ at: iso(minute(NOW - 7_200_000)), detail: 'deploy local' },
	{ at: iso(minute(NOW - 1_800_000)), detail: 'up' },
	{ at: iso(minute(NOW - 86_400_000)), detail: 'release' },
	{ at: iso(NOW), detail: 'stop' },
];
const FREEZES = [
	{ at: iso(NOW), detail: 'Freeze 2026-11-25 to 2026-11-27 on Production: Diwali sale (owner)' },
	{ at: iso(NOW), detail: 'Freeze 2026-12-01 to 2026-12-02: year end' },
	{ at: iso(NOW), detail: 'Something else' },
];
let n = 0;
const REQUESTS: Array<[number, number | null, number, number]> = [
	[NOW - 7_200_000 - 1_800_000, 200, 0.001, 100],
	[NOW - 7_200_000 + 600_000, 900, 0.05, 100],
	[NOW - 1_800_000 - 600_000, null, 0, 10],
	[NOW - 1_800_000 + 600_000, 100, 0, 10],
];
const ctx = (id: string | null, requests = REQUESTS): ProductCtx =>
	({
		key: `ship-key-${++n}`,
		id,
		range: '24h',
		repository: 'owner/shop',
		repo: {
			id: 'shop',
			environments: [
				{ name: 'production', label: 'Production', domains: ['example.test'], cloudId: 'c1', branch: 'main' },
				{ name: 'staging', label: 'Staging', domains: ['staging.example.test'], cloudId: 'c1', branch: 'dev' },
			],
		},
		localRequests: () => requests,
		recent: (kind: string) => (kind === 'calendar-freeze' ? FREEZES : []),
		recentAll: (kind: string) => (kind === 'local-job-started' ? MOMENTS : []),
		auditLog: () => [{ at: iso(NOW - 600_000), action: 'deploy', detail: 'production' }],
		envTags: () => ({}),
		writeKey: async () => `ship-write-${n}`,
	}) as unknown as ProductCtx;
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;

async function everything(id: string | null, requests = REQUESTS) {
	const out: string[] = [];
	for (const [name, screen] of Object.entries(SCREENS)) {
		for (const [tab, read] of Object.entries(screen.tabs))
			out.push(await read(ctx(id, requests)).then(JSON.stringify, (e: Error) => `${name}.${tab}: ${e.message}`));
		for (const [key, spec] of Object.entries(screen.forms ?? {}))
			out.push(
				await spec.read(ctx(id, requests)).then(JSON.stringify, (e: Error) => `${name}.${key}: ${e.message}`),
			);
	}
	return out.join('\n');
}

afterEach(() => {
	world = BUSY;
	deploys.calls.length = 0;
});

describe('the Ship screens', () => {
	it('reads a busy repository in every tab and form, for the first item and for each one by id', async () => {
		const all = await everything(null);
		expect(all).toContain('Sarees');
		for (const id of [
			'7',
			'8',
			'101',
			'102',
			'103',
			'104',
			'201',
			'401',
			'402',
			'203',
			'205',
			TAG,
			'1',
			'2',
			...MOMENTS.map((m) => m.at),
		])
			expect(await everything(id)).toBeTruthy();
		expect(await everything(null, [])).toBeTruthy();
	});

	it('words each way a release stops, from the failed job’s log', async () => {
		for (const text of Object.values(LOGS)) {
			log = text;
			expect(await everything('102')).toBeTruthy();
		}
		log = '';
	});

	it('adds a freeze to one environment or all, and refuses bad dates or an unknown place', async () => {
		const freeze = calendarScreen.forms?.['freeze'];
		const lone = {
			...ctx(null),
			repo: { id: 'shop', environments: [{ name: 'staging', label: '', domains: [] }] },
		} as unknown as ProductCtx;
		expect(JSON.stringify(await freeze?.read(lone))).toContain('"value":""');
		await expect(
			freeze?.send(ctx(null), write({ from: '2026-12-02', to: '2026-12-01', why: 'x' })),
		).rejects.toThrow('Dates as');
		await expect(
			freeze?.send(ctx(null), write({ from: '2026-12-01', to: '2026-12-02', env: 'moon', why: 'x' })),
		).rejects.toThrow('moon is not an environment');
		expect(
			(
				await freeze?.send(
					ctx(null),
					write({ from: '2026-12-01', to: '2026-12-02', env: 'production', why: 'Sale: Diwali' }),
				)
			)?.message,
		).toBe('Freeze 2026-12-01 to 2026-12-02 on Production: Sale  Diwali');
		expect(
			(await freeze?.send(lone, write({ from: '2026-12-01', to: '2026-12-02', env: 'staging', why: 'x' })))
				?.message,
		).toContain('on staging');
		expect(
			(await freeze?.send(ctx(null), write({ from: '2026-12-01', to: '2026-12-02', env: 3, why: 'x' })))?.message,
		).toContain('on every environment');
	});

	it('load-tests staging or a local stack in four stages, never production', async () => {
		const run = loadTestScreen.forms?.['run'];
		const envs = (list: unknown[]) =>
			({ ...ctx(null), repo: { id: 'shop', environments: list } }) as unknown as ProductCtx;
		const local = { name: 'local', label: 'This Mac', domains: ['localhost'], cloudId: null };
		expect(JSON.stringify(await run?.read(envs([local])))).toContain('"value":"local"');
		expect(JSON.stringify(await run?.read(envs([])))).toContain('No environment besides production');
		await expect(run?.send(ctx(null), write({ environment: 'production', paths: '/' }))).rejects.toThrow(
			'never load-tested',
		);
		await expect(run?.send(ctx(null), write({ environment: 'staging', paths: 'home' }))).rejects.toThrow(
			'at least one path',
		);
		const sent = await run?.send(
			ctx(null),
			write({ environment: 'staging', paths: '/\n/en/sarees', shoppers: 8, seconds: 10 }),
		);
		expect(sent?.follow?.map((f) => f.label)).toEqual([
			'2 shoppers for 10 s',
			'4 shoppers for 10 s',
			'6 shoppers for 10 s',
			'8 shoppers for 10 s',
		]);
		const [first] = sent?.follow ?? [];
		expect(first?.detail?.()).toBe('');
		expect(await first?.check('k')).toBe(false);
		expect(await first?.check('k')).toBe(true);
		expect(first?.detail?.()).toContain('40 requests');
		const before = process.env['CONSOLE_RUNNER_URL'];
		process.env['CONSOLE_RUNNER_URL'] = 'http://host.docker.internal:4419';
		expect(
			await run?.send(envs([local]), write({ environment: 'local', paths: '/', shoppers: 5, seconds: 10 })),
		).toBeTruthy();
		expect(
			await run?.send(
				envs([{ ...local, domains: [] }]),
				write({ environment: 'local', paths: '/', shoppers: 5, seconds: 10 }),
			),
		).toBeTruthy();
		if (before === undefined) delete process.env['CONSOLE_RUNNER_URL'];
		else process.env['CONSOLE_RUNNER_URL'] = before;
		expect(
			await run?.send(
				envs([{ ...local, domains: ['shop.test'] }]),
				write({ environment: 'local', paths: '/', shoppers: 5, seconds: 10 }),
			),
		).toBeTruthy();
	});

	it('reads a quiet repository, where there is nothing to show', async () => {
		world = QUIET;
		expect(await everything(null, [])).toBeTruthy();
	});

	it('starts a workflow, re-runs a failed run, and refuses a deploy to an unknown place', async () => {
		const start = pipelineScreen.forms?.['start'];
		await expect(
			start?.send(ctx(null), write({ workflow: '1', ref: 'main', environment: 'moon' })),
		).rejects.toThrow('Choose an environment.');
		expect(
			(await start?.send(ctx(null), write({ workflow: '1', ref: 'main', environment: 'staging' })))?.message,
		).toBe('Deploy started on main for staging');
		expect(
			(await start?.send(ctx(null), write({ workflow: '2', ref: 'dev', environment: 'staging' })))?.message,
		).toBe('CI started on dev');
		const rerun = pipelineScreen.forms?.['rerun'];
		await expect(rerun?.send(ctx(null), write({}))).rejects.toThrow('Choose a run.');
		expect((await rerun?.send(ctx('102'), write({})))?.message).toBe('Run 102: failed jobs started again');
	});

	it('approves or rejects a waiting release, and rolls back to a tag or the previous release', async () => {
		const pin = approvalsScreen.forms?.['pin'];
		await expect(pin?.send(ctx(null), write({ state: 'approved' }, '999', 'production'))).rejects.toThrow(
			'no longer waiting',
		);
		await expect(pin?.send(ctx(null), write({ state: 'maybe' }, '104', 'production'))).rejects.toThrow(
			'Approve or reject.',
		);
		expect((await pin?.send(ctx('104'), write({ state: 'approved' }, null, 'production')))?.message).toBe(
			'Release to production approved',
		);
		expect(
			(await pin?.send(ctx(null), write({ state: 'rejected', comment: 'Not today' }, '104', 'production')))
				?.message,
		).toBe('Release to production rejected');
		const fast = rollbackScreen.forms?.['fast'];
		await expect(fast?.send(ctx(null), write({ environment: 'moon' }, null, 'rollback'))).rejects.toThrow(
			'Choose where.',
		);
		expect((await fast?.send(ctx(null), write({ environment: 'production' }, null, 'rollback')))?.message).toBe(
			'Rolling production back to its previous release',
		);
		const confirm = rollbackScreen.forms?.['confirm'];
		await expect(confirm?.send(ctx(null), write({ tag: 'v1.0.0' }, null, 'rollback'))).rejects.toThrow(
			'Choose a release tag.',
		);
		expect((await confirm?.send(ctx(null), write({ tag: TAG }, null, 'rollback')))?.message).toBe(
			`Deploying ${TAG} to production`,
		);
		expect(deploys.calls).toHaveLength(2);
		for (const screen of [
			rehearsalScreen,
			loadTestScreen,
			impactScreen,
			calendarScreen,
			stepsScreen,
			logsScreen,
			pullsScreen,
		])
			for (const spec of Object.values(screen.forms ?? {})) {
				await spec.send(ctx(null), write({ environment: 'staging', minutes: 1 })).catch(() => null);
				await spec.send(ctx('7'), write({ environment: 'production' }, '7', '7')).catch(() => null);
			}
	});
});

describe('the dress rehearsal', () => {
	it('is ready, with its Start action, when staging, its last release and a production backup are all there', async () => {
		backup.ready = true;
		const view = JSON.stringify(await rehearsalScreen.tabs['run']?.(ctx(null)));
		backup.ready = false;
		expect(view).toContain('"status":"ready"');
		expect(view).toContain('"tone":"ok"');
		expect(view).toContain('Start a rehearsal');
	});
});
