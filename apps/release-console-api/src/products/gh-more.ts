/**
 * GitHub: the buttons GitHub's own pages have on the console's release screens (owner, 23 Nov: same
 * full parity as Cloudflare). Pull requests: merge, review, close or reopen, update the branch, run
 * failed checks again. Runs: cancel, run everything again, turn a workflow on or off. Releases: make,
 * change, delete. Actions variables: add, change, delete. Every change needs the PIN.
 */
import type { ProductWrite } from '@saha-textile/release-console-contracts';

import type { ProductCtx, ProductFormSpec } from './kit.js';
import { action, bool, confirmed, field, form, formTab, note, option, pick, read, text, write } from './kit.js';
import { type ScreenExtra } from './cf-zone-more.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

type Rec = Record<string, unknown>;
const GH = 'https://api.github.com';
const list = async (ctx: ProductCtx, path: string, field?: string, key = ctx.key): Promise<Rec[]> => {
	const b = await read('GitHub', `${GH}/repos/${ctx.repository}${path}`, key, 5_000);
	return arr(field ? rec(b)[field] : b).map(rec);
};
const send = (
	ctx: ProductCtx,
	key: string,
	method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
	path: string,
	body?: unknown,
) => write('GitHub', method, `${GH}/repos/${ctx.repository}${path}`, key, body ?? {});
const opt = (w: ProductWrite, key: string) => {
	const v = w.values[key];
	return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
};

/* ===== pull requests ===== */

async function prChoices(ctx: ProductCtx, withClosed = false) {
	const open = await list(ctx, '/pulls?state=open&per_page=50');
	const closed = withClosed
		? (await list(ctx, '/pulls?state=closed&per_page=15')).filter((p) => !p['merged_at'])
		: [];
	return [...open, ...closed];
}
const prLabel = (p: Rec) => `#${num(p['number'])} ${str(p['title'])}${str(p['state']) === 'closed' ? ' (closed)' : ''}`;

const mergeForm: ProductFormSpec = {
	async read(ctx) {
		const prs = await prChoices(ctx);
		const p = pick(
			'Pull request',
			prs.map((x) => ({ value: String(num(x['number'])), label: prLabel(x) })),
			ctx.id,
		);
		const pr = prs.find((x) => String(num(x['number'])) === p.value);
		return formTab(
			form({
				key: 'merge',
				title: pr ? `Merge #${num(pr['number'])}` : 'Merge a pull request',
				submit: 'Merge',
				blocked: pr ? null : 'No open pull requests.',
				confirmName: pr ? String(num(pr['number'])) : null,
				fields: [
					field('method', 'How', 'select', {
						value: 'merge',
						options: [
							option('merge', 'Merge commit'),
							option('squash', 'Squash and merge'),
							option('rebase', 'Rebase and merge'),
						],
						help: 'dev → staging → main use merge commits (the rulesets refuse squash there).',
					}),
					field('title', 'Commit title (optional)', 'text', {
						value: pr ? `${str(pr['title'])} (#${num(pr['number'])})` : '',
					}),
					field('deleteBranch', 'Delete the branch after merging', 'toggle', { value: false }),
				],
				notes: [
					note(
						'GitHub refuses the merge when a required check or review is missing, and says which.',
						'muted',
					),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const n = w.id ?? ctx.id;
		const pr = (await prChoices({ ...ctx, key })).find((x) => String(num(x['number'])) === n);
		if (!pr) throw new VendorError('Choose an open pull request.', 400);
		confirmed(w, String(num(pr['number'])));
		const method = ['merge', 'squash', 'rebase'].includes(opt(w, 'method')) ? opt(w, 'method') : 'merge';
		await send(ctx, key, 'PUT', `/pulls/${n}/merge`, {
			merge_method: method,
			...(opt(w, 'title') ? { commit_title: opt(w, 'title') } : {}),
		});
		const head = rec(pr['head']);
		if (
			bool(w, 'deleteBranch') &&
			str(rec(head['repo'])['full_name']) === ctx.repository &&
			!['main', 'dev', 'staging'].includes(str(head['ref']))
		)
			await send(ctx, key, 'DELETE', `/git/refs/heads/${encodeURIComponent(str(head['ref']))}`);
		return { message: `#${n} merged (${method})`, productId: n ?? null, follow: [] };
	},
};

const reviewForm: ProductFormSpec = {
	async read(ctx) {
		const prs = await prChoices(ctx);
		const p = pick(
			'Pull request',
			prs.map((x) => ({ value: String(num(x['number'])), label: prLabel(x) })),
			ctx.id,
		);
		return formTab(
			form({
				key: 'review',
				title: 'Review a pull request',
				submit: 'Send review',
				blocked: prs.length ? null : 'No open pull requests.',
				fields: [
					field('event', 'Review', 'select', {
						value: 'COMMENT',
						options: [
							option('APPROVE', 'Approve'),
							option('REQUEST_CHANGES', 'Request changes'),
							option('COMMENT', 'Comment only'),
						],
					}),
					field('body', 'Comment', 'textarea', { help: 'Needed for Request changes and Comment.' }),
				],
				notes: [note('GitHub does not let the author approve their own pull request.', 'muted')],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const n = w.id ?? ctx.id;
		if (!n) throw new VendorError('Choose a pull request.', 400);
		const event = opt(w, 'event');
		if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event)) throw new VendorError('Choose a review.', 400);
		const body = opt(w, 'body');
		if (event !== 'APPROVE' && !body) throw new VendorError('Write the comment.', 400);
		await send(ctx, key, 'POST', `/pulls/${n}/reviews`, { event, ...(body ? { body } : {}) });
		return { message: `#${n}: ${event.toLowerCase().replace('_', ' ')} sent`, productId: n, follow: [] };
	},
};

const prStateForm: ProductFormSpec = {
	async read(ctx) {
		const prs = await prChoices(ctx, true);
		const p = pick(
			'Pull request',
			prs.map((x) => ({ value: String(num(x['number'])), label: prLabel(x) })),
			ctx.id,
		);
		const pr = prs.find((x) => String(num(x['number'])) === p.value);
		const open = str(pr?.['state']) === 'open';
		return formTab(
			form({
				key: 'prstate',
				title: 'Close, reopen, update or check again',
				submit: 'Do it',
				blocked: pr ? null : 'No pull requests.',
				fields: [
					field('what', 'What', 'select', {
						value: open ? 'update' : 'reopen',
						options: open
							? [
									option('update', 'Bring the branch up to date with its base'),
									option('recheck', 'Run its failed checks again'),
									option('close', 'Close without merging'),
								]
							: [option('reopen', 'Reopen')],
					}),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const n = w.id ?? ctx.id;
		const pr = (await prChoices({ ...ctx, key }, true)).find((x) => String(num(x['number'])) === n);
		if (!pr) throw new VendorError('Choose a pull request.', 400);
		const what = opt(w, 'what');
		if (what === 'close' || what === 'reopen') {
			await send(ctx, key, 'PATCH', `/pulls/${n}`, { state: what === 'close' ? 'closed' : 'open' });
			return { message: `#${n} ${what === 'close' ? 'closed' : 'reopened'}`, productId: n ?? null, follow: [] };
		}
		if (what === 'update') {
			await send(ctx, key, 'PUT', `/pulls/${n}/update-branch`, {
				expected_head_sha: str(rec(pr['head'])['sha']),
			});
			return { message: `#${n}: branch brought up to date`, productId: n ?? null, follow: [] };
		}
		if (what === 'recheck') {
			const runs = await list(
				{ ...ctx, key },
				`/actions/runs?head_sha=${str(rec(pr['head'])['sha'])}&per_page=50`,
				'workflow_runs',
				key,
			);
			const failed = runs.filter((r) => ['failure', 'cancelled', 'timed_out'].includes(str(r['conclusion'])));
			for (const r of failed) await send(ctx, key, 'POST', `/actions/runs/${num(r['id'])}/rerun-failed-jobs`);
			return {
				message: `#${n}: ${failed.length} failed run${failed.length === 1 ? '' : 's'} started again`,
				productId: n ?? null,
				follow: [],
			};
		}
		throw new VendorError('Choose what to do.', 400);
	},
};

export const PULLS_EXTRA: ScreenExtra = {
	forms: { merge: mergeForm, review: reviewForm, prstate: prStateForm },
	buttons: {
		detail: [
			action('Merge', 'merge', 'primary'),
			action('Review', 'review'),
			action('Close, reopen or update', 'prstate'),
		],
		failed: [action('Run failed checks again', 'prstate'), action('Review', 'review')],
	},
};

/* ===== runs and workflows ===== */

const runForm: ProductFormSpec = {
	async read(ctx) {
		const runs = await list(ctx, '/actions/runs?per_page=30', 'workflow_runs');
		const p = pick(
			'Run',
			runs.map((r) => ({
				value: String(num(r['id'])),
				label: `${str(r['name'])} · ${str(r['head_branch'])} · ${str(r['status'])}${str(r['conclusion']) ? ` (${str(r['conclusion'])})` : ''}`,
			})),
			ctx.id,
		);
		const r = runs.find((x) => String(num(x['id'])) === p.value);
		const running = ['queued', 'in_progress', 'waiting', 'pending'].includes(str(r?.['status']));
		return formTab(
			form({
				key: 'run',
				title: 'Cancel a run or run it all again',
				submit: running ? 'Cancel the run' : 'Run every job again',
				blocked: r ? null : 'No runs yet.',
				fields: [
					field('what', 'What', 'select', {
						value: running ? 'cancel' : 'rerun',
						options: running
							? [option('cancel', 'Cancel it')]
							: [option('rerun', 'Run every job again, same commit')],
					}),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const id = w.id ?? ctx.id;
		if (!id) throw new VendorError('Choose a run.', 400);
		const what = opt(w, 'what');
		if (what === 'cancel') await send(ctx, key, 'POST', `/actions/runs/${id}/cancel`);
		else if (what === 'rerun') await send(ctx, key, 'POST', `/actions/runs/${id}/rerun`);
		else throw new VendorError('Choose what to do.', 400);
		return {
			message: `Run ${id}: ${what === 'cancel' ? 'cancelled' : 'started again'}`,
			productId: id,
			follow: [],
		};
	},
};

const workflowForm: ProductFormSpec = {
	async read(ctx) {
		const flows = await list(ctx, '/actions/workflows?per_page=100', 'workflows');
		const p = pick(
			'Workflow',
			flows.map((f) => ({
				value: String(num(f['id'])),
				label: `${str(f['name'])} (${str(f['state']).replace(/_/g, ' ')})`,
			})),
			ctx.id,
		);
		const f = flows.find((x) => String(num(x['id'])) === p.value);
		return formTab(
			form({
				key: 'workflow',
				title: 'Turn a workflow on or off',
				submit: 'Save',
				blocked: f ? null : 'No workflows.',
				fields: [
					field('on', 'Workflow', 'select', {
						value: str(f?.['state']) === 'active' ? 'on' : 'off',
						options: [option('on', 'On'), option('off', 'Off: it no longer runs, even on schedule')],
					}),
				],
				notes: [
					note(
						'Turning off Deploy or the checks a ruleset requires stops releases until it is on again.',
						'amber',
					),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const id = w.id ?? ctx.id;
		if (!id) throw new VendorError('Choose a workflow.', 400);
		const on = opt(w, 'on') === 'on';
		await send(ctx, key, 'PUT', `/actions/workflows/${id}/${on ? 'enable' : 'disable'}`);
		return { message: `Workflow ${id} ${on ? 'on' : 'off'}`, productId: id, follow: [] };
	},
};

export const PIPELINE_EXTRA: ScreenExtra = {
	forms: { run: runForm, workflow: workflowForm },
	buttons: { failed: [action('Cancel or run again', 'run'), action('Workflow on or off', 'workflow')] },
};

/* ===== releases ===== */

const releaseForm: ProductFormSpec = {
	async read(ctx) {
		const rels = await list(ctx, '/releases?per_page=30');
		const p = pick(
			'Release',
			[
				{ value: 'new', label: 'New release' },
				...rels.map((r) => ({
					value: String(num(r['id'])),
					label: `${str(r['tag_name'])} ${str(r['name'])}${r['draft'] ? ' (draft)' : ''}`,
				})),
			],
			ctx.id,
		);
		const r = rels.find((x) => String(num(x['id'])) === p.value) ?? null;
		return formTab(
			form({
				key: 'release',
				title: r ? `Edit ${str(r['tag_name'])}` : 'New release',
				submit: r ? 'Save release' : 'Publish release',
				fields: [
					field('tag', 'Tag', 'text', {
						value: str(r?.['tag_name']),
						required: true,
						readOnly: !!r,
						help: 'Like v1.4.0; made on the branch below when it does not exist',
					}),
					field('target', 'From branch', 'text', { value: str(r?.['target_commitish']) || 'main' }),
					field('name', 'Title', 'text', { value: str(r?.['name']) }),
					field('body', 'Notes', 'textarea', {
						value: str(r?.['body']),
						help: 'Empty on a new release: GitHub writes them from the merged pull requests.',
					}),
					field('draft', 'Draft', 'toggle', { value: r?.['draft'] === true }),
					field('prerelease', 'Pre-release', 'toggle', { value: r?.['prerelease'] === true }),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const id = w.id ?? ctx.id;
		const body = {
			name: opt(w, 'name'),
			body: opt(w, 'body'),
			draft: bool(w, 'draft'),
			prerelease: bool(w, 'prerelease'),
			target_commitish: opt(w, 'target') || 'main',
		};
		if (!id || id === 'new') {
			const tag = text(w, 'tag');
			if (!/^[\w.+-]{1,100}$/.test(tag)) throw new VendorError('Tag like v1.4.0.', 400);
			await send(ctx, key, 'POST', '/releases', {
				tag_name: tag,
				...body,
				...(body.body ? {} : { generate_release_notes: true }),
			});
			return {
				message: `Release ${tag} ${body.draft ? 'saved as draft' : 'published'}`,
				productId: null,
				follow: [],
			};
		}
		await send(ctx, key, 'PATCH', `/releases/${id}`, body);
		return { message: 'Release saved', productId: id, follow: [] };
	},
};

const releaseDelete: ProductFormSpec = {
	async read(ctx) {
		const rels = await list(ctx, '/releases?per_page=30');
		const p = pick(
			'Release',
			rels.map((r) => ({ value: String(num(r['id'])), label: `${str(r['tag_name'])} ${str(r['name'])}` })),
			ctx.id,
		);
		const r = rels.find((x) => String(num(x['id'])) === p.value);
		return formTab(
			form({
				key: 'releasedelete',
				title: 'Delete a release',
				submit: 'Delete release',
				danger: true,
				confirmName: r ? str(r['tag_name']) : null,
				blocked: r ? null : 'No releases.',
				fields: [field('tagToo', 'Delete its tag too', 'toggle', { value: false })],
				notes: [note('Without its tag a version cannot be rolled back to.', 'amber')],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const id = w.id ?? ctx.id;
		const r = (await list({ ...ctx, key }, '/releases?per_page=30', undefined, key)).find(
			(x) => String(num(x['id'])) === id,
		);
		if (!r) throw new VendorError('Choose a release.', 400);
		confirmed(w, str(r['tag_name']));
		await send(ctx, key, 'DELETE', `/releases/${id}`);
		if (bool(w, 'tagToo'))
			await send(ctx, key, 'DELETE', `/git/refs/tags/${encodeURIComponent(str(r['tag_name']))}`);
		return {
			message: `Release ${str(r['tag_name'])} deleted${bool(w, 'tagToo') ? ' with its tag' : ''}`,
			productId: null,
			follow: [],
		};
	},
};

export const ROLLBACK_EXTRA: ScreenExtra = {
	forms: { release: releaseForm, releasedelete: releaseDelete },
	buttons: { choose: [action('New or change a release', 'release'), action('Delete a release', 'releasedelete')] },
};

/* ===== Actions variables ===== */

const variablesForm: ProductFormSpec = {
	async read(ctx) {
		const [repoVars, envs] = await Promise.all([
			list(ctx, '/actions/variables?per_page=100', 'variables').catch(() => []),
			list(ctx, '/environments', 'environments').catch(() => []),
		]);
		const envVars = (
			await Promise.all(
				envs.map(async (e) =>
					(
						await list(
							ctx,
							`/environments/${encodeURIComponent(str(e['name']))}/variables?per_page=100`,
							'variables',
						).catch(() => [])
					).map((v) => ({ ...v, _env: str(e['name']) })),
				),
			)
		).flat();
		const all: Rec[] = [...repoVars.map((v) => ({ ...v, _env: '' })), ...envVars];
		const p = pick(
			'Variable',
			[
				{ value: 'new', label: 'New variable' },
				...all.map((v) => ({
					value: `${str(v['_env'])}:${str(v['name'])}`,
					label: `${str(v['name'])} (${str(v['_env']) || 'repository'})`,
				})),
			],
			ctx.id,
		);
		const v = all.find((x) => `${str(x['_env'])}:${str(x['name'])}` === p.value) ?? null;
		return formTab(
			form({
				key: 'variables',
				title: v ? `Change ${str(v['name'])}` : 'New Actions variable',
				submit: 'Save',
				fields: [
					field('scope', 'Where', 'select', {
						value: v ? str(v['_env']) : '',
						options: [
							option('', 'The whole repository'),
							...envs.map((e) => option(str(e['name']), `Environment ${str(e['name'])}`)),
						],
						readOnly: !!v,
					}),
					field('name', 'Name', 'text', {
						value: str(v?.['name']),
						required: true,
						readOnly: !!v,
						help: 'CAPITALS and _; values are visible to anyone who can read the repository (use a secret for secrets)',
					}),
					field('value', 'Value', 'textarea', { value: str(v?.['value']), help: 'Not for secrets' }),
					field('delete', 'Delete this variable', 'toggle', { value: false }),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const id = w.id ?? ctx.id;
		const existing = id && id !== 'new' ? id.split(':') : null;
		const scope = existing ? (existing[0] ?? '') : opt(w, 'scope');
		const name = existing ? (existing[1] ?? '') : text(w, 'name').toUpperCase();
		if (!/^[A-Z_][A-Z0-9_]{0,99}$/.test(name)) throw new VendorError('Name: capitals, digits and _.', 400);
		const base = scope ? `/environments/${encodeURIComponent(scope)}/variables` : '/actions/variables';
		if (bool(w, 'delete')) {
			if (!existing) throw new VendorError('Choose a variable to delete.', 400);
			await send(ctx, key, 'DELETE', `${base}/${name}`);
			return { message: `${name} deleted`, productId: null, follow: [] };
		}
		const value = opt(w, 'value');
		if (existing) await send(ctx, key, 'PATCH', `${base}/${name}`, { name, value });
		else await send(ctx, key, 'POST', base, { name, value });
		return { message: `${name} saved (${scope || 'repository'})`, productId: null, follow: [] };
	},
};

export const SECRETS_EXTRA: ScreenExtra = {
	tabs: { variables: (ctx) => variablesForm.read(ctx) },
	forms: { variables: variablesForm },
};

/* ===== Dependabot and code-scanning alerts: dismiss or reopen ===== */

async function alerts(ctx: ProductCtx, key = ctx.key) {
	const [deps, code] = await Promise.all([
		list(ctx, '/dependabot/alerts?per_page=100', undefined, key).catch(() => []),
		list(ctx, '/code-scanning/alerts?per_page=100', undefined, key).catch(() => []),
	]);
	return [
		...deps.map((a) => ({
			value: `dependabot:${num(a['number'])}`,
			label: `${str(rec(rec(a['dependency'])['package'])['name'])} · ${str(rec(a['security_advisory'])['severity'])} · ${str(a['state'])}`,
			state: str(a['state']),
		})),
		...code.map((a) => ({
			value: `code-scanning:${num(a['number'])}`,
			label: `${str(rec(a['rule'])['description']) || str(rec(a['rule'])['id'])} · ${str(a['state'])}`,
			state: str(a['state']),
		})),
	];
}

const DEP_REASONS = ['fix_started', 'inaccurate', 'no_bandwidth', 'not_used', 'tolerable_risk'];
const CODE_REASONS = ['false positive', "won't fix", 'used in tests'];

const dismissForm: ProductFormSpec = {
	async read(ctx) {
		const all = await alerts(ctx);
		const p = pick(
			'Alert',
			all.map((a) => ({ value: a.value, label: a.label })),
			ctx.id,
		);
		const a = all.find((x) => x.value === p.value);
		const kind = a?.value.split(':')[0];
		return formTab(
			form({
				key: 'dismiss',
				title: 'Dismiss or reopen an alert',
				submit: a?.state === 'dismissed' ? 'Reopen' : 'Dismiss',
				blocked: a ? null : 'No Dependabot or code-scanning alerts (or the token cannot read them).',
				fields:
					a && a.state !== 'dismissed'
						? [
								field('reason', 'Why', 'select', {
									value: kind === 'dependabot' ? 'tolerable_risk' : 'false positive',
									options: (kind === 'dependabot' ? DEP_REASONS : CODE_REASONS).map((r) =>
										option(r, r.replace(/_/g, ' ')),
									),
								}),
								field('comment', 'Note', 'text'),
							]
						: [],
				notes: [note('A dismissed alert stays on GitHub with its reason and can be reopened here.', 'muted')],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const a = (await alerts(ctx, key)).find((x) => x.value === (w.id ?? ctx.id));
		if (!a) throw new VendorError('Choose an alert.', 400);
		const [kind, n] = a.value.split(':');
		const reopen = a.state === 'dismissed';
		if (kind === 'dependabot')
			await send(
				ctx,
				key,
				'PATCH',
				`/dependabot/alerts/${n}`,
				reopen
					? { state: 'open' }
					: {
							state: 'dismissed',
							dismissed_reason: opt(w, 'reason') || 'tolerable_risk',
							dismissed_comment: opt(w, 'comment'),
						},
			);
		else
			await send(
				ctx,
				key,
				'PATCH',
				`/code-scanning/alerts/${n}`,
				reopen
					? { state: 'open' }
					: {
							state: 'dismissed',
							dismissed_reason: opt(w, 'reason') || 'false positive',
							dismissed_comment: opt(w, 'comment'),
						},
			);
		return {
			message: `${a.label.split(' · ')[0]} ${reopen ? 'reopened' : 'dismissed'}`,
			productId: null,
			follow: [],
		};
	},
};

/** Not a whole screen: the Dependencies page's own tab for dismissing alerts. */
export const depsAlertsScreen = {
	vendor: 'github' as const,
	tabs: { dismiss: (ctx: ProductCtx) => dismissForm.read(ctx) },
	forms: { dismiss: dismissForm },
};
