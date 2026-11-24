/**
 * Ship screens (brief console.js and v5): pull requests and their checks, starting and reading
 * workflow runs, approvals, release steps, impact, rollback, the release calendar, the dress
 * rehearsal and the load test, read live from GitHub (and the local request log for impact).
 */
import {
	DEPLOY_WORKFLOW,
	RELEASE_TAG,
	type ServerTarget,
	deployFailureOf,
	releaseTagTime,
} from '@saha-textile/release-console-contracts';

import type { Follow, ProductCtx, ProductScreen } from './kit.js';
import {
	action,
	ago,
	col,
	confirmed,
	fact,
	field,
	form,
	formTab,
	int,
	note,
	option,
	pick,
	read,
	row,
	stat,
	table,
	text,
	toneOf,
	view,
	when,
	write,
} from './kit.js';
import { runLoad } from './loadtest.js';
import { productionBackup } from './production-backup.js';
import { startServerDeploy } from '../vendors/github-deploys.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

const GH = 'https://api.github.com';
const gh = (path: string, key: string, ttl?: number) => read('GitHub', `${GH}${path}`, key, ttl);
const ghList = async (ctx: ProductCtx, path: string, field?: string, ttl?: number) => {
	const b = await gh(`/repos/${ctx.repository}${path}`, ctx.key, ttl);
	return arr(field ? rec(b)[field] : b).map(rec);
};
const ghSoft = async (ctx: ProductCtx, path: string, field?: string) =>
	ghList(ctx, path, field).catch(() => [] as Record<string, unknown>[]);

/** The last lines of a job's log, newest last, errors marked. */
async function logTail(
	ctx: ProductCtx,
	jobId: string,
	lines = 120,
): Promise<Array<{ n: number; text: string; bad: boolean }>> {
	const res = await fetch(`${GH}/repos/${ctx.repository}/actions/jobs/${jobId}/logs`, {
		headers: {
			authorization: `Bearer ${ctx.key}`,
			'user-agent': 'release-console',
			accept: 'application/vnd.github+json',
		},
		redirect: 'follow',
		signal: AbortSignal.timeout(20_000),
	});
	if (!res.ok)
		return [
			{
				n: 0,
				text: `GitHub answered ${res.status} for this job’s log (it may still be running, or older than 90 days).`,
				bad: false,
			},
		];
	const all = (await res.text()).split('\n');
	const start = Math.max(0, all.length - lines);
	return all.slice(start).map((l, i) => {
		const t = l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, '');
		return { n: start + i + 1, text: t, bad: /##\[error\]|\berror\b|failed|✖|ERR!/i.test(t) };
	});
}

const logTable = (title: string, lines: Array<{ n: number; text: string; bad: boolean }>) =>
	table(
		title,
		[col('n', '#', true), col('line', 'Line', true)],
		lines.map((l) => row(String(l.n), String(l.n), { n: l.n, line: l.text || ' ' }, l.bad ? 'red' : null)),
		'No log.',
	);

const stepsTable = (job: Record<string, unknown>) =>
	table(
		`Steps of ${str(job['name'])}`,
		[col('n', '#', true), col('name', 'Step'), col('state', 'Result'), col('took', 'Took', true)],
		arr(job['steps'])
			.map(rec)
			.map((s) => {
				const a = Date.parse(str(s['started_at']));
				const b = Date.parse(str(s['completed_at']));
				const state = str(s['conclusion']) || str(s['status']);
				return row(
					String(num(s['number'])),
					str(s['name']),
					{
						n: num(s['number']),
						name: str(s['name']),
						state,
						took:
							Number.isFinite(a) && Number.isFinite(b)
								? `${Math.max(0, Math.round((b - a) / 1000))} s`
								: str(s['status']) === 'in_progress'
									? 'running'
									: '—',
					},
					toneOf(state === 'success' ? 'ok' : state),
				);
			}),
		'No steps.',
	);

const runTone = (r: Record<string, unknown>) =>
	toneOf(str(r['conclusion']) === 'success' ? 'ok' : str(r['conclusion']) || str(r['status']));
const runLabel = (r: Record<string, unknown>) =>
	`#${num(r['run_number'])} ${str(r['name'])} · ${str(r['head_branch'])} · ${str(r['conclusion']) || str(r['status'])}`;

/* ===== Pull requests (beyond the list) ===== */

async function prPick(ctx: ProductCtx, onlyFailing = false) {
	const pulls = await ghList(ctx, '/pulls?state=open&per_page=30');
	const withChecks = await Promise.all(
		pulls.map(async (p) => {
			const runs = await ghSoft(
				ctx,
				`/commits/${str(rec(p['head'])['sha'])}/check-runs?per_page=100`,
				'check_runs',
			);
			return { p, runs };
		}),
	);
	const list = onlyFailing
		? withChecks.filter((x) =>
				x.runs.some((c) => ['failure', 'timed_out', 'cancelled'].includes(str(c['conclusion']))),
			)
		: withChecks;
	const picker = pick(
		'Pull request',
		list.map((x) => ({ value: String(num(x.p['number'])), label: `#${num(x.p['number'])} ${str(x.p['title'])}` })),
		ctx.id,
	);
	return { list, picker, chosen: list.find((x) => String(num(x.p['number'])) === picker.value) ?? null };
}

const checksTable = (runs: Record<string, unknown>[], title = 'Checks') =>
	table(
		title,
		[col('name', 'Check'), col('app', 'From'), col('state', 'Result'), col('took', 'Took', true)],
		runs.map((c) => {
			const a = Date.parse(str(c['started_at']));
			const b = Date.parse(str(c['completed_at']));
			const state = str(c['conclusion']) || str(c['status']);
			return row(
				String(num(c['id'])),
				str(c['name']),
				{
					name: str(c['name']),
					app: str(rec(c['app'])['name']),
					state,
					took: Number.isFinite(a) && Number.isFinite(b) ? `${Math.round((b - a) / 1000)} s` : '—',
				},
				toneOf(state === 'success' ? 'ok' : state === 'failure' ? 'error' : state),
			);
		}),
		'No checks on this commit.',
	);

const prView = (failingOnly: boolean) => async (ctx: ProductCtx) => {
	const { picker, chosen } = await prPick(ctx, failingOnly);
	if (!chosen)
		return view({
			notes: [
				note(
					failingOnly ? 'No open pull request has a failed check.' : 'No open pull requests.',
					failingOnly ? 'ok' : 'muted',
				),
			],
		});
	const { p, runs } = chosen;
	const [full, commits] = await Promise.all([
		gh(`/repos/${ctx.repository}/pulls/${num(p['number'])}`, ctx.key).then(rec),
		ghSoft(ctx, `/pulls/${num(p['number'])}/commits?per_page=100`),
	]);
	const bad = runs.filter((c) => ['failure', 'timed_out', 'cancelled'].includes(str(c['conclusion'])));
	const running = runs.filter((c) => str(c['status']) !== 'completed');
	return view(
		{
			head: {
				name: `#${num(p['number'])} ${str(p['title'])}`,
				status: bad.length
					? 'merge blocked'
					: running.length
						? 'checks running'
						: str(full['mergeable_state']) || 'open',
				tone: bad.length ? 'red' : running.length ? 'amber' : 'ok',
			},
			stats: [
				stat('Checks', runs.length),
				stat('Failed', bad.length),
				stat('Running', running.length),
				stat('Commits', commits.length),
			],
			facts: [
				fact('Author', str(rec(p['user'])['login'])),
				fact('Branch', `${str(rec(p['head'])['ref'])} → ${str(rec(p['base'])['ref'])}`),
				fact(
					'Changes',
					`+${num(full['additions'])} −${num(full['deletions'])} in ${num(full['changed_files'])} files`,
				),
				fact('Description', str(p['body']).slice(0, 500) || '—'),
			],
			tables: [
				checksTable(failingOnly ? bad : runs),
				table(
					'Commits',
					[col('sha', 'Commit', true), col('msg', 'Message'), col('who', 'Who')],
					commits.map((c) =>
						row(str(c['sha']), str(rec(c['commit'])['message']), {
							sha: str(c['sha']).slice(0, 7),
							msg: str(rec(c['commit'])['message']).split('\n')[0] as string,
							who: str(rec(rec(c['commit'])['author'])['name']),
						}),
					),
					'No commits.',
				),
			],
			links: [{ label: 'Open on GitHub', url: str(p['html_url']) }],
		},
		picker,
	);
};

const checksPage = (mode: 'all' | 'failed' | 'outside') => async (ctx: ProductCtx) => {
	const { picker, chosen } = await prPick(ctx, mode === 'failed');
	if (!chosen)
		return view({
			notes: [
				note(
					mode === 'failed' ? 'No open pull request has a failed check.' : 'No open pull requests.',
					'muted',
				),
			],
		});
	const runs =
		mode === 'outside' ? chosen.runs.filter((c) => str(rec(c['app'])['slug']) !== 'github-actions') : chosen.runs;
	const focus =
		mode === 'failed'
			? runs.find((c) => str(c['conclusion']) === 'failure')
			: (runs.find((c) => str(c['status']) !== 'completed') ?? runs[0]);
	const tables = [checksTable(runs, mode === 'outside' ? 'Checks from outside tools' : 'All checks')];
	if (focus && str(rec(focus['app'])['slug']) === 'github-actions') {
		const job = rec(await gh(`/repos/${ctx.repository}/actions/jobs/${num(focus['id'])}`, ctx.key, 5000));
		tables.push(stepsTable(job));
		if (mode === 'failed')
			tables.push(
				logTable(
					`Log of ${str(focus['name'])} (last lines, errors red)`,
					await logTail(ctx, String(num(focus['id']))),
				),
			);
	} else if (focus) {
		const out = rec(focus['output']);
		tables.push(
			table(
				`${str(focus['name'])} says`,
				[col('what', 'Part'), col('text', 'Text')],
				[
					row('t', 'title', { what: 'Title', text: str(out['title']) || '—' }),
					row('s', 'summary', { what: 'Summary', text: str(out['summary']).slice(0, 600) || '—' }),
				],
				'Nothing reported.',
			),
		);
	}
	return view(
		{
			notes:
				mode === 'outside' && !runs.length
					? [
							note(
								'No outside tool (such as SonarCloud) reports on this pull request; only GitHub Actions does.',
								'muted',
							),
						]
					: [],
			tables,
			links: focus ? [{ label: 'Open the check on GitHub', url: str(focus['html_url']) }] : [],
		},
		picker,
	);
};

export const pullsScreen: ProductScreen = {
	vendor: 'github',
	tabs: {
		detail: prView(false),
		failed: prView(true),
		checks: checksPage('all'),
		checksFailed: checksPage('failed'),
		sonar: checksPage('outside'),
	},
};

/* ===== Pipelines: start a run, a failed run explained ===== */

const startForm = async (ctx: ProductCtx) => {
	const [flows, branches] = await Promise.all([
		ghList(ctx, '/actions/workflows?per_page=100', 'workflows'),
		ghList(ctx, '/branches?per_page=100'),
	]);
	const active = flows.filter((f) => str(f['state']) === 'active');
	return formTab(
		form({
			key: 'start',
			title: 'Start a run',
			submit: 'Start run',
			fields: [
				field('workflow', 'Workflow', 'select', {
					options: active.map((f) => option(String(num(f['id'])), str(f['name']), str(f['path']))),
					// String(num(…)) is never empty ("0" when there is no workflow).
					value: String(
						num(active.find((f) => str(f['path']).endsWith('ci.yml'))?.['id'] ?? active[0]?.['id']),
					),
					required: true,
				}),
				field('ref', 'Branch', 'select', {
					options: branches.map((b) => option(str(b['name']), str(b['name']))),
					value: branches.find((b) => str(b['name']) === 'feat/combined-after-pr6')
						? 'feat/combined-after-pr6'
						: str(branches[0]?.['name']) || null,
				}),
				field('environment', 'Environment (deploy only)', 'select', {
					value: 'staging',
					options: [
						option('staging', 'staging'),
						option('development', 'development'),
						option('production', 'production'),
					],
					help: 'Only used by the deploy workflow; production also needs its approval on GitHub.',
				}),
			],
			notes: [
				note(
					'Only workflows with a manual start (workflow_dispatch) accept this; GitHub says so if one does not.',
					'muted',
				),
			],
		}),
	);
};

const failedRun = async (ctx: ProductCtx) => {
	const runs = await ghList(ctx, '/actions/runs?status=failure&per_page=20', 'workflow_runs');
	const p = pick(
		'Failed run',
		runs.map((r) => ({ value: String(num(r['id'])), label: runLabel(r) })),
		ctx.id,
	);
	const r = runs.find((x) => String(num(x['id'])) === p.value);
	if (!r) return view({ notes: [note('No failed runs. Every recent workflow passed.', 'ok')] });
	const jobs = await ghList(ctx, `/actions/runs/${num(r['id'])}/jobs?per_page=50`, 'jobs');
	const bad = jobs.find((j) => str(j['conclusion']) === 'failure') ?? jobs[0];
	const badStep = arr(bad?.['steps'])
		.map(rec)
		.find((s) => str(s['conclusion']) === 'failure');
	return view(
		{
			head: { name: runLabel(r), status: 'failed', tone: 'red' },
			facts: [
				fact(
					'Commit',
					`${str(r['head_sha']).slice(0, 7)} · ${str(rec(r['head_commit'])['message']).split('\n')[0]}`,
				),
				fact('Started by', str(rec(r['actor'])['login'])),
				fact('Failed in', `${str(bad?.['name'])} › ${str(badStep?.['name']) || 'a step'}`),
				fact('When', `${when(str(r['created_at']))} (${ago(str(r['created_at']))})`),
			],
			tables: [
				table(
					'Jobs',
					[col('name', 'Job'), col('state', 'Result')],
					jobs.map((j) =>
						row(
							String(num(j['id'])),
							str(j['name']),
							{ name: str(j['name']), state: str(j['conclusion']) || str(j['status']) },
							toneOf(
								str(j['conclusion']) === 'success'
									? 'ok'
									: str(j['conclusion']) === 'failure'
										? 'error'
										: 'muted',
							),
						),
					),
					'No jobs.',
				),
				...(bad
					? [
							logTable(
								`Log of ${str(bad['name'])} (last lines, errors red)`,
								await logTail(ctx, String(num(bad['id']))),
							),
						]
					: []),
			],
			links: [{ label: 'Open the run on GitHub', url: str(r['html_url']) }],
			actions: [action('Run it again', 'rerun', 'primary')],
		},
		p,
	);
};

export const pipelineScreen: ProductScreen = {
	vendor: 'github',
	tabs: { start: startForm, failed: failedRun },
	forms: {
		start: {
			read: startForm,
			async send(ctx, w) {
				const key = await ctx.writeKey();
				const wf = text(w, 'workflow');
				const flow = rec(await gh(`/repos/${ctx.repository}/actions/workflows/${wf}`, key));
				const isDeploy = str(flow['path']).endsWith(DEPLOY_WORKFLOW);
				const env = text(w, 'environment');
				if (isDeploy && !['staging', 'development', 'production'].includes(env))
					throw new VendorError('Choose an environment.', 400);
				await write('GitHub', 'POST', `${GH}/repos/${ctx.repository}/actions/workflows/${wf}/dispatches`, key, {
					ref: text(w, 'ref'),
					...(isDeploy ? { inputs: { environment: env } } : {}),
				});
				return {
					message: `${str(flow['name'])} started on ${text(w, 'ref')}${isDeploy ? ` for ${env}` : ''}`,
					productId: wf,
					follow: [],
				};
			},
		},
		rerun: {
			read: async () =>
				formTab(
					form({
						key: 'rerun',
						title: 'Run the failed jobs again',
						submit: 'Run again',
						notes: [note('Only the failed jobs run again, on the same commit.', 'muted')],
					}),
				),
			async send(ctx, w) {
				const key = await ctx.writeKey();
				const id = w.id ?? ctx.id;
				if (!id) throw new VendorError('Choose a run.', 400);
				await write(
					'GitHub',
					'POST',
					`${GH}/repos/${ctx.repository}/actions/runs/${id}/rerun-failed-jobs`,
					key,
					{},
				);
				return { message: `Run ${id}: failed jobs started again`, productId: id, follow: [] };
			},
		},
	},
};

/* ===== Job logs ===== */

const jobLogs = (running: boolean) => async (ctx: ProductCtx) => {
	const runs = await ghList(
		ctx,
		`/actions/runs?per_page=15${running ? '&status=in_progress' : '&status=completed'}`,
		'workflow_runs',
		running ? 3000 : undefined,
	);
	const jobs = (
		await Promise.all(
			runs
				.slice(0, 8)
				.map(async (r) =>
					(
						await ghList(
							ctx,
							`/actions/runs/${num(r['id'])}/jobs?per_page=30`,
							'jobs',
							running ? 3000 : undefined,
						)
					).map((j): Record<string, unknown> => ({ ...j, _run: runLabel(r) })),
				),
		)
	).flat();
	const p = pick(
		'Job',
		jobs.map((j) => ({ value: String(num(j['id'])), label: `${str(j['_run'])} › ${str(j['name'])}` })),
		ctx.id,
	);
	const j = jobs.find((x) => String(num(x['id'])) === p.value);
	if (!j)
		return view({
			notes: [
				note(running ? 'Nothing is running on GitHub Actions right now.' : 'No finished jobs yet.', 'muted'),
			],
		});
	const state = str(j['conclusion']) || str(j['status']);
	return view(
		{
			head: {
				name: str(j['name']),
				status: state,
				tone: toneOf(state === 'success' ? 'ok' : state === 'failure' ? 'error' : state),
			},
			facts: [
				fact('Run', str(j['_run'])),
				fact('Runner', str(j['runner_name']) || '—'),
				fact('Started', when(str(j['started_at']))),
			],
			tables: [
				stepsTable(j),
				...(running
					? []
					: [logTable('Log (last lines, errors red)', await logTail(ctx, String(num(j['id']))))]),
			],
			notes: running
				? [note('Steps refresh every few seconds; GitHub publishes the full log when the job ends.', 'cy')]
				: [],
			links: [{ label: 'Open on GitHub', url: str(j['html_url']) }],
		},
		p,
	);
};

export const logsScreen: ProductScreen = {
	vendor: 'github',
	tabs: { finished: jobLogs(false), running: jobLogs(true) },
};

/* ===== Approvals ===== */

async function waiting(ctx: ProductCtx) {
	const runs = await ghList(ctx, '/actions/runs?status=waiting&per_page=20', 'workflow_runs', 5000);
	const pending = await Promise.all(
		runs.map(async (r) => ({
			r,
			envs: arr(
				await gh(`/repos/${ctx.repository}/actions/runs/${num(r['id'])}/pending_deployments`, ctx.key, 5000),
			).map(rec),
		})),
	);
	return pending.filter((x) => x.envs.length);
}

const approvalCard = async (ctx: ProductCtx) => {
	const list = await waiting(ctx);
	const p = pick(
		'Waiting release',
		list.map((x) => ({
			value: String(num(x.r['id'])),
			label: `${runLabel(x.r)} → ${x.envs.map((e) => str(rec(e['environment'])['name'])).join(', ')}`,
		})),
		ctx.id,
	);
	const c = list.find((x) => String(num(x.r['id'])) === p.value);
	if (!c) return view({ notes: [note('Nothing is waiting for approval.', 'ok')] });
	const env = str(rec(c.envs[0]?.['environment'])['name']);
	const last = (await ghSoft(ctx, `/deployments?environment=${env}&per_page=1`))[0];
	const cmp = last
		? rec(
				await gh(
					`/repos/${ctx.repository}/compare/${str(last['sha'])}...${str(c.r['head_sha'])}`,
					ctx.key,
				).catch(() => ({})),
			)
		: {};
	return view(
		{
			head: { name: `Release to ${env}`, status: 'waiting for you', tone: 'amber' },
			facts: [
				fact('Run', runLabel(c.r)),
				fact(
					'Commit',
					`${str(c.r['head_sha']).slice(0, 7)} · ${str(rec(c.r['head_commit'])['message']).split('\n')[0]}`,
				),
				fact(
					'Since the last release',
					last ? `${num(cmp['ahead_by'])} commits, ${arr(cmp['files']).length} files` : 'first release here',
				),
				fact('Waiting since', ago(str(c.r['updated_at']))),
			],
			tables: [
				table(
					'What goes out',
					[col('sha', 'Commit', true), col('msg', 'Message'), col('who', 'Who')],
					arr(cmp['commits'])
						.map(rec)
						.slice(-30)
						.reverse()
						.map((x) =>
							row(str(x['sha']), str(x['sha']), {
								sha: str(x['sha']).slice(0, 7),
								msg: str(rec(x['commit'])['message']).split('\n')[0] as string,
								who: str(rec(rec(x['commit'])['author'])['name']),
							}),
						),
					'No commits to compare.',
				),
			],
			actions: [action('Approve or reject', 'pin', 'primary')],
			links: [{ label: 'Open the run on GitHub', url: str(c.r['html_url']) }],
		},
		p,
	);
};

const approvalForm = async (ctx: ProductCtx) => {
	const list = await waiting(ctx);
	const p = pick(
		'Waiting release',
		list.map((x) => ({ value: String(num(x.r['id'])), label: runLabel(x.r) })),
		ctx.id,
	);
	const c = list.find((x) => String(num(x.r['id'])) === p.value);
	const env = str(rec(c?.envs[0]?.['environment'])['name']);
	return formTab(
		form({
			key: 'pin',
			title: c ? `Approve the release to ${env}` : 'Approve',
			submit: 'Send decision',
			blocked: c ? null : 'Nothing is waiting for approval.',
			fields: c
				? [
						field('state', 'Decision', 'cards', {
							value: 'approved',
							options: [
								option('approved', 'Approve', 'The release goes on.'),
								option('rejected', 'Reject', 'The run stops here.'),
							],
						}),
						field('comment', 'Comment', 'text', { value: '' }),
					]
				: [],
			confirmName: c ? env : null,
			danger: env === 'production',
		}),
		p,
	);
};

export const approvalsScreen: ProductScreen = {
	vendor: 'github',
	tabs: {
		card: approvalCard,
		pin: approvalForm,
		history: async (ctx) => {
			const deps = await ghList(ctx, '/deployments?per_page=20');
			const statuses = await Promise.all(
				deps.map(async (d) => rec((await ghSoft(ctx, `/deployments/${num(d['id'])}/statuses?per_page=1`))[0])),
			);
			return view({
				tables: [
					table(
						'Releases and their outcome',
						[
							col('at', 'When', true),
							col('env', 'Where'),
							col('ref', 'What', true),
							col('who', 'Who'),
							col('state', 'Outcome'),
						],
						deps.map((d, i) =>
							row(
								String(num(d['id'])),
								str(d['ref']),
								{
									at: when(str(d['created_at'])),
									env: str(d['environment']),
									ref: `${str(d['ref'])} ${str(d['sha']).slice(0, 7)}`,
									who: str(rec(d['creator'])['login']),
									state: str(statuses[i]?.['state']) || '—',
								},
								toneOf(str(statuses[i]?.['state']) === 'success' ? 'ok' : str(statuses[i]?.['state'])),
							),
						),
						'No releases recorded on GitHub yet.',
					),
				],
				notes: [
					note('Approvals given in the console also appear in Governance › Audit with the PIN.', 'muted'),
				],
			});
		},
	},
	forms: {
		pin: {
			read: approvalForm,
			async send(ctx, w) {
				const key = await ctx.writeKey();
				const id = w.id ?? ctx.id;
				const c = (await waiting({ ...ctx, key })).find((x) => String(num(x.r['id'])) === id);
				if (!c) throw new VendorError('That release is no longer waiting.', 400);
				const env = str(rec(c.envs[0]?.['environment'])['name']);
				confirmed(w, env);
				const state = text(w, 'state');
				if (!['approved', 'rejected'].includes(state)) throw new VendorError('Approve or reject.', 400);
				await write(
					'GitHub',
					'POST',
					`${GH}/repos/${ctx.repository}/actions/runs/${id}/pending_deployments`,
					key,
					{
						environment_ids: c.envs.map((e) => num(rec(e['environment'])['id'])),
						state,
						comment: text(w, 'comment', false) || `${state} in the Release Console`,
					},
				);
				return { message: `Release to ${env} ${state}`, productId: id, follow: [] };
			},
		},
	},
};

/* ===== Release steps ===== */

async function deployRuns(ctx: ProductCtx) {
	return ghList(ctx, `/actions/workflows/${DEPLOY_WORKFLOW}/runs?per_page=20`, 'workflow_runs').catch(
		() => [] as Record<string, unknown>[],
	);
}

const releasePlan = (mode: 'plan' | 'blocked') => async (ctx: ProductCtx) => {
	const runs = await deployRuns(ctx);
	const list = mode === 'blocked' ? runs.filter((r) => str(r['conclusion']) === 'failure') : runs;
	const p = pick(
		'Release',
		list.map((r) => ({ value: String(num(r['id'])), label: runLabel(r) })),
		ctx.id,
	);
	const r = list.find((x) => String(num(x['id'])) === p.value);
	if (!r)
		return view({
			notes: [
				note(
					mode === 'blocked'
						? 'No release was stopped by a failed check.'
						: 'No release has run yet: the first comes from Live deploy once a server exists.',
					'muted',
				),
			],
		});
	const jobs = await ghList(ctx, `/actions/runs/${num(r['id'])}/jobs?per_page=30`, 'jobs');
	const all = jobs.flatMap((j) =>
		arr(j['steps'])
			.map(rec)
			.map((s) => ({ j, s })),
	);
	const stop = all.find((x) => str(x.s['conclusion']) === 'failure');
	// The release step that failed and its message, from the failed job's log (Release Path brief F12).
	const tail = stop ? await logTail(ctx, String(num(stop.j['id'])), 600) : [];
	const failure = deployFailureOf(tail.map((l) => l.text));
	return view(
		{
			head: {
				name: runLabel(r),
				status: stop ? `stopped at ${str(stop.s['name'])}` : str(r['conclusion']) || str(r['status']),
				tone: stop ? 'red' : runTone(r),
			},
			notes: stop
				? [
						note(
							// A release-step failure always names its step (deployFailureOf).
							failure?.kind === 'release-step'
								? `${failure.step as string} failed: ${failure.message}. The deploy stopped before the switch; the shop kept serving the previous release.`
								: failure?.kind === 'refused-secrets'
									? `The server refused the release: ${failure.names.join(', ')} in Infisical differ from what the database, Redis or search run with. Nothing changed; deploy again with rotation from Live deploy.`
									: failure
										? `The server stopped: ${failure.message}. The shop kept serving the previous release.`
										: `The release stopped before the switch: “${str(stop.s['name'])}” failed in ${str(stop.j['name'])}. The shop kept serving the previous release.`,
							failure?.kind === 'refused-secrets' ? 'amber' : 'red',
						),
					]
				: [],
			tables: [
				table(
					'Every step in this release',
					[col('job', 'Job'), col('step', 'Step'), col('state', 'Result'), col('at', 'Started', true)],
					all.map(({ j, s }, i) =>
						row(
							String(i),
							str(s['name']),
							{
								job: str(j['name']),
								step: str(s['name']),
								state: str(s['conclusion']) || str(s['status']),
								at: when(str(s['started_at'])),
							},
							toneOf(
								str(s['conclusion']) === 'success'
									? 'ok'
									: str(s['conclusion']) === 'failure'
										? 'error'
										: str(s['conclusion']) || str(s['status']),
							),
						),
					),
					'No steps.',
				),
				...(stop ? [logTable(`Log of ${str(stop.j['name'])} (last lines, errors red)`, tail.slice(-120))] : []),
			],
			links: [{ label: 'Open on GitHub', url: str(r['html_url']) }],
		},
		p,
	);
};

const migrations = async (ctx: ProductCtx) => {
	const dirs = ['apps/api/src/migrations', 'packages/adapters-db-mongo/src/migrations', 'scripts/db/migrations'];
	const found = (
		await Promise.all(
			dirs.map(async (d) =>
				(await ghSoft(ctx, `/contents/${d}`)).map((f): Record<string, unknown> => ({ ...f, _dir: d })),
			),
		)
	)
		.flat()
		.filter((f) => str(f['type']) === 'file');
	return view({
		stats: [stat('Migrations in the code', found.length)],
		tables: [
			table(
				'Data migrations the release runs',
				[col('name', 'Migration', true), col('dir', 'Folder', true), col('size', 'Size', true)],
				found.map((f) =>
					row(str(f['sha']), str(f['name']), {
						name: str(f['name']),
						dir: str(f['_dir']),
						size: `${Math.round(num(f['size']) / 102.4) / 10} KB`,
					}),
				),
				'No migration folder in the repository: this release changes no data.',
			),
		],
		notes: [
			note(
				'Migrations run while the shop serves, in the deploy’s release step; a failed one stops the release before the switch. Which ran where is in each server’s ops log (Run › Database › Drift).',
				'muted',
			),
		],
	});
};

export const stepsScreen: ProductScreen = {
	vendor: 'github',
	tabs: { plan: releasePlan('plan'), migration: migrations, blocked: releasePlan('blocked') },
};

/* ===== Release impact (local request log: the hour before against the hour after) ===== */

export const impactScreen: ProductScreen = {
	vendor: 'github',
	tabs: {
		compare: async (ctx) => {
			const moments = ctx
				.recentAll('local-job-started')
				.filter((e) => /deploy|up|release|start/i.test(e.detail))
				.slice(0, 10);
			const p = pick(
				'Release',
				moments.map((m) => ({ value: m.at, label: `${when(m.at)} · ${m.detail}` })),
				ctx.id,
			);
			const series = ctx.localRequests(24 * 60);
			if (!p.value || !series.length)
				return view(
					{
						notes: [
							note(
								!series.length
									? 'The local request log is empty: start the local stack and use the shop, then compare.'
									: 'No local release recorded yet; deploy from Live deploy › local first.',
								'muted',
							),
							note(
								'Staging and production compare the same way once their servers send request data to the console (Watch › APM).',
								'muted',
							),
						],
					},
					p.options.length ? p : null,
				);
			const t = Math.floor(Date.parse(p.value) / 60000) * 60000;
			const before = series.filter(([m]) => m >= t - 3_600_000 && m < t);
			const after = series.filter(([m]) => m >= t && m < t + 3_600_000);
			const sum = (rows: typeof series) => ({
				req: rows.reduce((a, r) => a + r[3], 0),
				err: rows.reduce((a, r) => a + r[2] * r[3], 0),
				p95: rows.length ? Math.max(...rows.map((r) => r[1] ?? 0)) : 0,
			});
			const b = sum(before);
			const a = sum(after);
			const pc = (x: number, y: number) => (y ? `${Math.round((x / y) * 1000) / 10}%` : '—');
			const worse = a.req && b.req && a.err / a.req > (b.err / b.req) * 1.5 + 0.005;
			return view(
				{
					head: {
						name: `Local release at ${when(p.value)}`,
						status: worse ? 'errors rose' : 'no change for the worse',
						tone: worse ? 'red' : 'ok',
					},
					tables: [
						table(
							'The hour before against the hour after',
							[col('what', 'Measure'), col('before', 'Before', true), col('after', 'After', true)],
							[
								row('req', 'Requests', { what: 'Requests', before: b.req, after: a.req }),
								row(
									'err',
									'Server errors',
									{ what: 'Server errors (5xx)', before: pc(b.err, b.req), after: pc(a.err, a.req) },
									worse ? 'red' : null,
								),
								row(
									'p95',
									'Slowest minute (p95)',
									{
										what: 'Slowest minute (p95)',
										before: `${Math.round(b.p95)} ms`,
										after: `${Math.round(a.p95)} ms`,
									},
									a.p95 > b.p95 * 1.5 && a.p95 > 500 ? 'amber' : null,
								),
							],
							'No data.',
						),
					],
					notes: [
						note(
							'Sales and payments are compared once the shop API publishes order totals to the console (Shop › Payments).',
							'muted',
						),
					],
				},
				p,
			);
		},
	},
};

/* ===== Rollback (Release Path brief F16, approved 23 Nov: both rollbacks) ===== */

async function releases(ctx: ProductCtx) {
	const [tags, deps] = await Promise.all([
		ghSoft(ctx, '/tags?per_page=100'),
		ghSoft(ctx, '/deployments?per_page=30'),
	]);
	// Release tags deploy.yml pushes after each healthy deploy: <environment>-<yyyymmdd-hhmmss>-<sha8>.
	const releaseTags = tags
		.map((t) => ({ name: str(t['name']), sha: str(rec(t['commit'])['sha']).slice(0, 7) }))
		.map((t) => ({ ...t, env: RELEASE_TAG.exec(t.name)?.[1] ?? '', at: releaseTagTime(t.name) }))
		.filter((t) => t.env && t.at)
		.sort((a, b) => b.name.localeCompare(a.name));
	return { releaseTags, deps };
}

const SERVER_ENVS: ServerTarget[] = ['staging', 'production'];

const rollbackChoose = async (ctx: ProductCtx) => {
	const { releaseTags, deps } = await releases(ctx);
	return view({
		tables: [
			table(
				'Release history (GitHub deployments)',
				[col('at', 'When', true), col('env', 'Where'), col('ref', 'Version', true), col('who', 'Who')],
				deps.map((d) =>
					row(String(num(d['id'])), str(d['ref']), {
						at: when(str(d['created_at'])),
						env: str(d['environment']),
						ref: `${str(d['ref'])} ${str(d['sha']).slice(0, 7)}`,
						who: str(rec(d['creator'])['login']),
					}),
				),
				'No releases recorded yet.',
			),
			table(
				'Versions you can deploy again (release tags)',
				[col('name', 'Tag', true), col('env', 'Where'), col('at', 'Made', true), col('sha', 'Commit', true)],
				releaseTags.map((t) =>
					// releases() keeps only tags with a time.
					row(t.name, t.name, { name: t.name, env: t.env, at: when(t.at as string), sha: t.sha }),
				),
				'No release tags yet: each healthy deploy now gets one (staging-…, production-…).',
			),
		],
		notes: [
			note(
				'Roll back swaps the previous release back in on the server in seconds, from images already on its disk, its passwords included. Deploy an older version runs the deploy on one release tag. The database is never rolled back: migrations only add, so the older code still reads it.',
				'muted',
			),
			note(
				'After a leak, deploy forward instead: rolling back past a rotation brings the leaked values back.',
				'amber',
			),
		],
		actions: [action('Roll back', 'fast', 'danger'), action('Deploy an older version', 'confirm')],
	});
};

const envField = () =>
	field('environment', 'Where', 'select', {
		value: 'staging',
		options: SERVER_ENVS.map((e) => option(e, e)),
		required: true,
	});

const rollbackFast = async () =>
	formTab(
		form({
			key: 'fast',
			title: 'Roll back',
			submit: 'Roll back',
			danger: true,
			fields: [envField()],
			confirmName: 'rollback',
			notes: [
				note(
					'The server swaps the previous release back in, passwords included, with no failed request. Type rollback to confirm.',
					'amber',
				),
			],
		}),
	);

const rollbackForm = async (ctx: ProductCtx) => {
	const { releaseTags } = await releases(ctx);
	return formTab(
		form({
			key: 'confirm',
			title: 'Deploy an older version',
			submit: 'Deploy this version',
			danger: true,
			blocked: releaseTags.length ? null : 'No release tags yet: each healthy deploy now gets one.',
			fields: [
				field('tag', 'Version', 'select', {
					options: releaseTags.map((t) => option(t.name, t.name, `${t.env} · ${t.sha}`)),
					value: releaseTags[1]?.name ?? releaseTags[0]?.name ?? null,
					required: true,
				}),
			],
			confirmName: 'rollback',
			notes: [
				note(
					'Runs the deploy on that tag for the environment it names; the environment must allow its tags (the server create sets staging-* and production-*). Type rollback to confirm.',
					'amber',
				),
			],
		}),
	);
};

export const rollbackScreen: ProductScreen = {
	vendor: 'github',
	tabs: { choose: rollbackChoose, confirm: rollbackForm, fast: rollbackFast },
	forms: {
		fast: {
			read: rollbackFast,
			async send(ctx, w) {
				const key = await ctx.writeKey();
				confirmed(w, 'rollback');
				const env = text(w, 'environment') as ServerTarget;
				if (!SERVER_ENVS.includes(env)) throw new VendorError('Choose where.', 400);
				await startServerDeploy(ctx.repository, env, key, undefined, undefined, [], { action: 'rollback' });
				return { message: `Rolling ${env} back to its previous release`, productId: env, follow: [] };
			},
		},
		confirm: {
			read: rollbackForm,
			async send(ctx, w) {
				const key = await ctx.writeKey();
				confirmed(w, 'rollback');
				const tag = text(w, 'tag');
				const env = RELEASE_TAG.exec(tag)?.[1] as ServerTarget | undefined;
				if (!env || !SERVER_ENVS.includes(env)) throw new VendorError('Choose a release tag.', 400);
				await startServerDeploy(ctx.repository, env, key, undefined, undefined, [], { tag });
				return { message: `Deploying ${tag} to ${env}`, productId: tag, follow: [] };
			},
		},
	},
};

/* ===== Release calendar ===== */

interface Freeze {
	from: string;
	to: string;
	why: string;
	/** The environment it holds (owner, 23 Nov: labels on pages without the switch); older ones hold every one. */
	env: string;
}
const freezesOf = (ctx: ProductCtx): Freeze[] =>
	ctx
		.recent('calendar-freeze')
		.map((e) => {
			const m = /^Freeze (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})(?: on ([^:]+))?: (.*)$/.exec(
				e.detail.replace(/ \([^)]*\)$/, ''),
			);
			// The dates and the reason always take part in a match; the environment is optional.
			return m
				? { from: m[1] as string, to: m[2] as string, env: m[3] ?? 'every environment', why: m[4] as string }
				: null;
		})
		.filter((f): f is Freeze => !!f);
/** A day's releases by environment, from GitHub's deployments ("✓ 2 releases · Staging, Production"). */
const releasesOn = (ctx: ProductCtx, deps: Record<string, unknown>[], day: string): string => {
	const hits = deps.filter((x) => str(x['created_at']).startsWith(day));
	if (!hits.length) return '';
	const envs = [...new Set(hits.map((x) => str(x['environment'])).filter(Boolean))].map(
		(n) => ctx.repo.environments.find((e) => e.name === n)?.label ?? n,
	);
	return ` ✓ ${hits.length} release${hits.length > 1 ? 's' : ''}${envs.length ? ` · ${envs.join(', ')}` : ''}`;
};

export const calendarScreen: ProductScreen = {
	vendor: 'github',
	tabs: {
		month: async (ctx) => {
			const now = new Date();
			const months = [0, 1, 2].map((i) =>
				new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)).toISOString().slice(0, 7),
			);
			const p = pick(
				'Month',
				months.map((m) => ({ value: m, label: m })),
				ctx.id,
			);
			// The three months are always there, so one is always picked.
			const month = p.value as string;
			const deps = await ghSoft(ctx, '/deployments?per_page=100');
			const freezes = freezesOf(ctx);
			const [y, m] = month.split('-').map(Number) as [number, number];
			const first = new Date(Date.UTC(y, m - 1, 1));
			const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
			const lead = (first.getUTCDay() + 6) % 7;
			const cell = (d: number) => {
				const day = `${month}-${String(d).padStart(2, '0')}`;
				const fr = freezes.filter((f) => f.from <= day && day <= f.to);
				return `${d}${fr.length ? ` ⛔ freeze · ${fr.map((f) => f.env).join(', ')}` : ''}${releasesOn(ctx, deps, day)}`;
			};
			const weeks: string[][] = [];
			for (let i = 0; i < lead + days; i += 7)
				weeks.push(
					Array.from({ length: 7 }, (_, k) =>
						i + k >= lead && i + k - lead < days ? cell(i + k - lead + 1) : '',
					),
				);
			const hours = new Array<number>(24).fill(0);
			for (const [t, , , n] of ctx.localRequests(7 * 24 * 60)) {
				// An hour of the day, 0–23: always one of the 24 slots.
				const h = (new Date(t).getUTCHours() + 5) % 24;
				hours[h] = (hours[h] as number) + n;
			}
			const quiet = hours
				.map((n, h) => [h, n] as const)
				.filter(([, n]) => n > 0)
				.sort((a, b) => a[1] - b[1])
				.slice(0, 3);
			return view(
				{
					tables: [
						table(
							`Releases and freezes · ${month}`,
							['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => col(d, d)),
							weeks.map((w, i) =>
								row(
									String(i),
									`week ${i + 1}`,
									Object.fromEntries(
										w.map((c, k) => [
											['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][k] as string,
											c,
										]),
									),
									w.some((c) => c.includes('⛔')) ? 'amber' : null,
								),
							),
							'No days.',
						),
						table(
							'Freezes',
							[
								col('from', 'From', true),
								col('to', 'To', true),
								col('env', 'Environment'),
								col('why', 'Why'),
							],
							freezes.map((f, i) =>
								row(String(i), f.why, { from: f.from, to: f.to, env: f.env, why: f.why }),
							),
							'No freezes. Add one for each sale event.',
						),
					],
					notes: [
						quiet.length
							? note(
									`Quietest hours (IST, last 7 days of local traffic): ${quiet.map(([h]) => `${h}:00`).join(', ')}.`,
									'cy',
								)
							: note('Quietest hours are suggested once there is traffic to measure.', 'muted'),
					],
					actions: [action('Add a freeze', 'freeze', 'primary')],
				},
				p,
			);
		},
	},
	forms: {
		freeze: {
			read: async (ctx) =>
				formTab(
					form({
						key: 'freeze',
						title: 'Add a release freeze',
						submit: 'Add freeze',
						fields: [
							field('from', 'From (YYYY-MM-DD)', 'text', { required: true }),
							field('to', 'To (YYYY-MM-DD)', 'text', { required: true }),
							field('env', 'Environment', 'select', {
								value: ctx.repo.environments.some((e) => e.name === 'production') ? 'production' : '',
								options: [
									option('', 'Every environment'),
									...ctx.repo.environments.map((e) => option(e.name, e.label || e.name)),
								],
							}),
							field('why', 'Why', 'text', { value: 'Sale event' }),
						],
						notes: [
							note('Live deploy warns during a freeze; production needs its approval anyway.', 'muted'),
						],
					}),
				),
			async send(ctx, w) {
				const from = text(w, 'from');
				const to = text(w, 'to');
				if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from)
					throw new VendorError('Dates as YYYY-MM-DD, the end not before the start.', 400);
				const picked = typeof w.values['env'] === 'string' ? w.values['env'] : '';
				const env = ctx.repo.environments.find((e) => e.name === picked);
				if (picked && !env) throw new VendorError(`${picked} is not an environment of this repository.`, 400);
				const why = text(w, 'why').replace(/:/g, ' ');
				return {
					message: `Freeze ${from} to ${to} on ${env ? env.label || env.name : 'every environment'}: ${why}`,
					productId: null,
					follow: [],
				};
			},
		},
	},
};

/* ===== Rehearsal ===== */

export const rehearsalScreen: ProductScreen = {
	vendor: 'github',
	tabs: {
		run: async (ctx) => {
			const staging = ctx.repo.environments.find((e) => e.name === 'staging');
			const runs = await deployRuns(ctx);
			const lastStaging = runs.find((r) => /staging/i.test(str(r['display_title']) + str(r['name'])));
			const backup = await productionBackup(ctx);
			const checks: Array<[string, boolean, string]> = [
				[
					'A staging server',
					!!staging?.cloudId,
					staging?.cloudId ? 'linked' : 'create it in DigitalOcean › Droplets',
				],
				['A production backup to restore', backup.ready, backup.detail],
				['The deploy workflow', true, `${DEPLOY_WORKFLOW} in the repository`],
				['Last staging release', !!lastStaging, lastStaging ? runLabel(lastStaging) : 'none yet'],
			];
			return view({
				head: {
					name: 'Dress rehearsal',
					status: checks.every((c) => c[1]) ? 'ready' : 'waiting on what is missing',
					tone: checks.every((c) => c[1]) ? 'ok' : 'amber',
				},
				tables: [
					table(
						'What a rehearsal needs',
						[col('what', 'Needs'), col('ok', 'Ready'), col('detail', 'Now')],
						checks.map(([what, ok, detail]) =>
							row(what, what, { what, ok: ok ? 'yes' : 'no', detail }, ok ? 'ok' : 'amber'),
						),
						'Nothing.',
					),
				],
				notes: [
					note(
						'A rehearsal restores last night’s production backup onto staging, then runs the release steps against it, so a migration meets real data before production.',
						'cy',
					),
				],
				actions: checks.every((c) => c[1]) ? [action('Start a rehearsal', 'start', 'primary')] : [],
			});
		},
	},
	forms: {
		start: {
			read: async () =>
				formTab(
					form({
						key: 'start',
						title: 'Start a rehearsal',
						submit: 'Start rehearsal',
						blocked:
							'Waiting on a production backup: the rehearsal starts once the production server makes its first nightly backup.',
					}),
				),
			async send() {
				throw new VendorError('Waiting on a production backup.', 400);
			},
		},
	},
};

/* ===== Load test ===== */

export const loadTestScreen: ProductScreen = {
	vendor: 'github',
	tabs: {
		run: async (ctx) => {
			const envs = ctx.repo.environments.filter((e) => e.name !== 'production' && e.domains.length);
			return formTab(
				form({
					key: 'run',
					title: 'Load test',
					submit: 'Start load test',
					fields: [
						field('environment', 'Where', 'select', {
							options: envs.map((e) => option(e.name, `${e.label} · ${e.domains[0]}`)),
							value: envs.find((e) => e.name === 'staging')?.name ?? envs[0]?.name ?? null,
							required: true,
						}),
						field('shoppers', 'Shoppers at once (peak)', 'number', { value: 100, min: 5, max: 300 }),
						field('seconds', 'Seconds per stage', 'number', { value: 20, min: 10, max: 120 }),
						field('paths', 'Pages', 'textarea', {
							value: '/\n/en/sarees\n/api/health/ready',
							help: 'One path per line; each shopper loads them in turn.',
						}),
					],
					notes: [
						note(
							'Runs in four stages (25%, 50%, 75%, 100% of the shoppers) and reports where it slows. Production is never load-tested.',
							'amber',
						),
					],
					blocked: envs.length ? null : 'No environment besides production has a domain to test.',
				}),
			);
		},
	},
	forms: {
		run: {
			read: (ctx) => loadTestScreen.tabs['run']!(ctx),
			async send(ctx, w) {
				const env = ctx.repo.environments.find((e) => e.name === text(w, 'environment'));
				if (!env || env.name === 'production')
					throw new VendorError('Choose staging or local; production is never load-tested.', 400);
				const host = env.domains[0] ?? '';
				const base =
					env.cloudId === null
						? `http://${process.env['CONSOLE_RUNNER_URL']?.includes('host.docker.internal') && host === 'localhost' ? 'host.docker.internal' : host}`
						: `https://${host}`;
				const paths = text(w, 'paths')
					.split('\n')
					.map((x) => x.trim())
					.filter((x) => x.startsWith('/'))
					.slice(0, 10);
				if (!paths.length) throw new VendorError('Give at least one path starting with /.', 400);
				const peak = int(w, 'shoppers', 5, 300);
				const seconds = int(w, 'seconds', 10, 120);
				const stages = [0.25, 0.5, 0.75, 1].map((f) => Math.max(1, Math.round(peak * f)));
				const results: string[] = [];
				let running: Promise<void> | null = null;
				const follow: Follow[] = stages.map((n, i) => ({
					label: `${n} shoppers for ${seconds} s`,
					async check() {
						if (!running) {
							running = runLoad(base, paths, n, seconds).then((r) => {
								results[i] =
									`${r.requests} requests · p50 ${r.p50} ms · p95 ${r.p95} ms · errors ${r.errors}`;
							});
							return false;
						}
						await running;
						running = null;
						return true;
					},
					detail: () => results[i] ?? '',
				}));
				return { message: `Load test on ${env.label}: up to ${peak} shoppers`, productId: env.name, follow };
			},
		},
	},
};
