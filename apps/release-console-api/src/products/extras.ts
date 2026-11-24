/**
 * The remaining tabs of the approved menu: a pool's fixed size, a new App Platform app, buckets,
 * the registry plan, load balancer members, an AI agent, DigitalOcean's secrets tabs, Cloudflare
 * billing, and writing a GitHub environment secret from the console (Run › Secrets › Write).
 */
import type { ProductCtx, ProductFormSpec, ProductScreen } from './kit.js';
import {
	col,
	confirmed,
	fact,
	field,
	form,
	formTab,
	int,
	list,
	note,
	option,
	pick,
	row,
	slug,
	table,
	text,
	usd,
	view,
	when,
} from './kit.js';
import { cfAll, cfSoft, zoneOf } from './cf-kit.js';
import { doAll, doGet, doSend, doSoft, dropletsOf } from './do-kit.js';
import { buckets, s3, tags } from './do-services.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

const GH = 'https://api.github.com';

function addForm(screen: ProductScreen, key: string, spec: ProductFormSpec): void {
	screen.forms = { ...(screen.forms ?? {}), [key]: spec };
	screen.tabs[key] = spec.read;
}

/* ----- DigitalOcean ----- */

const autoscaleOp: ProductFormSpec = {
	async read(ctx) {
		const pools = (await doAll('/droplets/autoscale', 'autoscale_pools', ctx.key, true)) ?? [];
		const p = pick(
			'Pool',
			pools.map((x) => ({ value: str(x['id']), label: str(x['name']) })),
			ctx.id,
		);
		const pool = pools.find((x) => str(x['id']) === p.value);
		return formTab(
			form({
				key: 'op',
				title: pool ? `Hold ${str(pool['name'])} at a fixed size` : 'Fixed size',
				submit: 'Set fixed size',
				blocked: pool ? null : 'No autoscale pools.',
				fields: pool
					? [
							field('n', 'Droplets', 'number', {
								value: num(pool['active_resources_count']) || 1,
								min: 1,
								max: 50,
							}),
						]
					: [],
				cost: 'Each droplet in the pool is billed at its size’s price.',
				notes: [
					note('A fixed size stops autoscaling until you set a minimum and maximum again (Edit).', 'amber'),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const id = w.id ?? ctx.id;
		const pool = rec((await doGet(`/droplets/autoscale/${id}`, key))['autoscale_pool']);
		if (!str(pool['id'])) throw new VendorError('Choose a pool.', 400);
		await doSend('PUT', `/droplets/autoscale/${str(pool['id'])}`, key, {
			name: str(pool['name']),
			config: { target_number_instances: int(w, 'n', 1, 50) },
			droplet_template: pool['droplet_template'],
		});
		return {
			message: `${str(pool['name'])} held at ${text(w, 'n')} droplets`,
			productId: str(pool['id']),
			follow: [],
		};
	},
};

const appCreate: ProductFormSpec = {
	read: async (ctx) =>
		formTab(
			form({
				key: 'create',
				title: 'New App Platform app from GitHub',
				submit: 'Create app',
				fields: [
					field('name', 'Name', 'text', { required: true, value: `${ctx.repo.id}-blog` }),
					field('repo', 'GitHub repository', 'text', { value: ctx.repository, required: true }),
					field('branch', 'Branch', 'text', { value: 'main' }),
					field('dir', 'Folder in the repository', 'text', { value: '/' }),
					field('port', 'Port it listens on', 'number', { value: 8080, min: 1, max: 65_535 }),
					field('region', 'Region', 'select', {
						value: 'blr',
						options: ['blr', 'sgp', 'fra', 'ams', 'lon', 'nyc', 'sfo', 'tor', 'syd'].map((r) =>
							option(r, r),
						),
					}),
				],
				cost: 'From $5 a month for one basic container (DigitalOcean list price).',
				notes: [note('DigitalOcean must be allowed to read the repository (its GitHub app) first.', 'muted')],
			}),
		),
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const name = slug(text(w, 'name'));
		const repo = text(w, 'repo');
		if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new VendorError('Repository as owner/name.', 400);
		const spec = {
			name,
			region: text(w, 'region'),
			services: [
				{
					name: 'web',
					github: { repo, branch: text(w, 'branch'), deploy_on_push: true },
					// text() refuses an empty folder, so it is always given.
					source_dir: text(w, 'dir'),
					http_port: int(w, 'port', 1, 65_535),
					instance_count: 1,
					instance_size_slug: 'apps-s-1vcpu-0.5gb',
				},
			],
		};
		const a = rec((await doSend('POST', '/apps', key, { spec }))['app']);
		return { message: `App ${name} created; its first build starts`, productId: str(a['id']), follow: [] };
	},
};

const registryEdit: ProductFormSpec = {
	read: async (ctx) => {
		const sub = rec(rec((await doSoft('/registry/subscription', ctx.key))?.['subscription'])['tier']);
		return formTab(
			form({
				key: 'edit',
				title: 'Registry plan',
				submit: 'Change plan',
				blocked: str(sub['slug']) ? null : 'No container registry.',
				fields: [
					field('tier', 'Plan', 'cards', {
						value: str(sub['slug']) || 'starter',
						options: [
							option('starter', 'Starter', 'free · 1 repository · 500 MB'),
							option('basic', 'Basic', '$5 a month · 5 repositories · 5 GB'),
							option('professional', 'Professional', '$20 a month · unlimited · 100 GB'),
						],
					}),
				],
				cost: 'Starter is free; Basic $5 and Professional $20 a month.',
			}),
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const tier = text(w, 'tier');
		if (!['starter', 'basic', 'professional'].includes(tier)) throw new VendorError('Choose a plan.', 400);
		await doSend('POST', '/registry/subscription', key, { tier_slug: tier });
		return { message: `Registry plan set to ${tier}`, productId: null, follow: [] };
	},
};

const peeringEdit: ProductFormSpec = {
	read: async (ctx) => {
		const list_ = (await doAll('/vpc_peerings', 'vpc_peerings', ctx.key, true)) ?? [];
		const p = pick(
			'Peering',
			list_.map((x) => ({ value: str(x['id']), label: str(x['name']) })),
			ctx.id,
		);
		const x = list_.find((y) => str(y['id']) === p.value);
		return formTab(
			form({
				key: 'edit',
				title: 'Rename a peering',
				submit: 'Save',
				blocked: x ? null : 'No VPC peerings.',
				fields: x ? [field('name', 'Name', 'text', { value: str(x['name']) })] : [],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const id = w.id ?? ctx.id;
		if (!id) throw new VendorError('Choose a peering.', 400);
		await doSend('PATCH', `/vpc_peerings/${id}`, key, { name: slug(text(w, 'name')) });
		return { message: `Peering renamed to ${text(w, 'name')}`, productId: id, follow: [] };
	},
};

const lbMembers: ProductFormSpec = {
	read: async (ctx) => {
		const [lbs, droplets] = await Promise.all([
			doAll('/load_balancers', 'load_balancers', ctx.key, true),
			dropletsOf(ctx.key),
		]);
		const p = pick(
			'Load balancer',
			(lbs ?? []).map((x) => ({ value: str(x['id']), label: str(x['name']) })),
			ctx.id,
		);
		const lb = (lbs ?? []).find((x) => str(x['id']) === p.value);
		return formTab(
			form({
				key: 'op',
				title: 'Droplets behind it',
				submit: 'Save droplets',
				blocked: lb
					? str(lb['tag'])
						? `It sends to every droplet tagged ${str(lb['tag'])}; tag a droplet to add it.`
						: null
					: 'No load balancers.',
				fields: lb
					? [
							field('droplets', 'Droplets', 'multi', {
								options: droplets
									.filter((d) => str(rec(d['region'])['slug']) === str(rec(lb['region'])['slug']))
									.map((d) => option(String(num(d['id'])), str(d['name']))),
								value: arr(lb['droplet_ids']).map((d) => String(num(d))),
							}),
						]
					: [],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const id = w.id ?? ctx.id;
		const lb = rec((await doGet(`/load_balancers/${id}`, key))['load_balancer']);
		const now = arr(lb['droplet_ids']).map((d) => num(d));
		const want = list(w, 'droplets').map(Number).filter(Number.isInteger);
		const add = want.filter((d) => !now.includes(d));
		const drop = now.filter((d) => !want.includes(d));
		if (add.length) await doSend('POST', `/load_balancers/${id}/droplets`, key, { droplet_ids: add });
		if (drop.length) await doSend('DELETE', `/load_balancers/${id}/droplets`, key, { droplet_ids: drop });
		return {
			message: `${str(lb['name'])}: +${add.length} −${drop.length} droplets`,
			productId: id ?? null,
			follow: [],
		};
	},
};

const agentCreate: ProductFormSpec = {
	read: async (ctx) => {
		const [models, projects] = await Promise.all([
			doSoft('/gen-ai/models?per_page=100', ctx.key),
			doAll('/projects', 'projects', ctx.key, true),
		]);
		const ms = arr(models?.['models'])
			.map(rec)
			.filter((m) => m['is_foundational'] === true || str(m['uuid']));
		return formTab(
			form({
				key: 'create',
				title: 'New AI agent',
				submit: 'Create agent',
				blocked: ms.length ? null : 'No models readable with this key (it needs the GenAI read right).',
				fields: [
					field('name', 'Name', 'text', { required: true }),
					field('model', 'Model', 'select', {
						options: ms.map((m) => option(str(m['uuid']), str(m['name']))),
						value: str(ms[0]?.['uuid']) || null,
					}),
					field('instruction', 'Instructions', 'textarea', { required: true }),
					field('project', 'Project', 'select', {
						options: (projects ?? []).map((p) => option(str(p['id']), str(p['name']))),
						value: str((projects ?? []).find((p) => p['is_default'] === true)?.['id']) || null,
					}),
					field('region', 'Region', 'select', {
						value: 'tor1',
						options: ['tor1', 'nyc3', 'ams3', 'sfo3'].map((r) => option(r, r)),
					}),
				],
				cost: 'Billed per token the agent reads and writes, at the model’s price.',
			}),
		);
	},
	async send(ctx, w) {
		const key = await ctx.writeKey();
		const a = rec(
			(
				await doSend('POST', '/gen-ai/agents', key, {
					name: text(w, 'name'),
					model_uuid: text(w, 'model'),
					instruction: text(w, 'instruction'),
					project_id: text(w, 'project'),
					region: text(w, 'region'),
				})
			)['agent'],
		);
		return { message: `Agent ${str(a['name'])} created`, productId: str(a['uuid']), follow: [] };
	},
};

/* ----- Spaces buckets ----- */

const bucketCreate: ProductFormSpec = {
	read: async (ctx) =>
		formTab(
			form({
				key: 'create',
				title: 'New Spaces bucket',
				submit: 'Create bucket',
				fields: [
					field('name', 'Name', 'text', {
						required: true,
						value: `${ctx.repo.id}-backups-staging`,
						help: 'Lowercase, digits and dashes; unique across all of Spaces.',
					}),
					field('region', 'Region', 'select', {
						value: 'sgp1',
						options: ['sgp1', 'blr1', 'fra1', 'ams3', 'nyc3', 'sfo3', 'syd1'].map((r) => option(r, r)),
					}),
				],
				cost: 'Included in the $5 a month Spaces subscription (250 GiB in all).',
				notes: [
					note(
						'The console’s Spaces key may be limited to one bucket; Spaces then refuses, and the bucket is made on DigitalOcean’s page.',
						'muted',
					),
				],
			}),
		),
	async send(ctx, w) {
		const name = text(w, 'name');
		if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(name))
			throw new VendorError('Lowercase letters, digits and dashes, 3 to 63.', 400);
		await s3(ctx, '/', text(w, 'region'), name, 'PUT');
		return { message: `Bucket ${name} created`, productId: name, follow: [] };
	},
};

const bucketDestroy: ProductFormSpec = {
	read: async (ctx) => {
		const all = await buckets(ctx);
		const p = pick(
			'Bucket',
			all.map((b) => ({ value: b.name, label: b.name })),
			ctx.id,
		);
		const b = all.find((x) => x.name === p.value);
		const files = b
			? tags(await s3(ctx, '/?list-type=2&max-keys=1', b.region, b.name).catch(() => ''), 'Contents').length
			: 0;
		return formTab(
			form({
				key: 'destroy',
				title: 'Delete an empty bucket',
				submit: 'Delete bucket',
				danger: true,
				confirmName: b?.name ?? null,
				blocked: !b
					? 'No buckets.'
					: files
						? `${b.name} still holds files. The console never empties a bucket; delete its files on DigitalOcean’s page first.`
						: null,
			}),
			p,
		);
	},
	async send(ctx, w) {
		const all = await buckets(ctx);
		const b = all.find((x) => x.name === (w.id ?? ctx.id));
		if (!b) throw new VendorError('Choose a bucket.', 400);
		confirmed(w, b.name);
		await s3(ctx, '/', b.region, b.name, 'DELETE');
		return { message: `Bucket ${b.name} deleted`, productId: null, follow: [] };
	},
};

const keyRotate: ProductFormSpec = {
	read: async () =>
		formTab(
			form({
				key: 'op',
				title: 'Rotate the Spaces key',
				submit: 'Rotate',
				blocked:
					'A new key’s secret is shown once, so making it stays your step on DigitalOcean (API › Spaces Keys). Paste it into Infisical, run pnpm console:env, then delete the old key there.',
				notes: [
					note(
						'Steps: make the new key limited to the bucket → paste into Infisical (both environments that use it) → deploy → delete the old key.',
						'cy',
					),
				],
			}),
		),
	async send() {
		throw new VendorError('Key creation is your step on DigitalOcean.', 400);
	},
};

/* ----- DigitalOcean "Secrets manager" tabs ----- */

const appsWithSecrets = async (ctx: ProductCtx) =>
	((await doAll('/apps', 'apps', ctx.key, true)) ?? []).filter((a) =>
		JSON.stringify(a['spec'] ?? {}).includes('"SECRET"'),
	);
const inInfisical = (what: string): ProductFormSpec => ({
	read: async () =>
		formTab(
			form({
				key: what,
				title:
					what === 'create' ? 'New secret' : what === 'edit' ? 'New version of a secret' : 'Delete a secret',
				submit: 'Open Run › Secrets',
				blocked:
					'This project keeps its secrets in Infisical, not DigitalOcean. Add, change or remove them on Run › Secrets (names here, values in Infisical).',
			}),
		),
	async send() {
		throw new VendorError('Secrets live in Infisical (Run › Secrets).', 400);
	},
});

/* ----- Cloudflare billing ----- */

const cfBilling = async (ctx: ProductCtx) => {
	const z = await zoneOf(ctx);
	const [subs, profile] = await Promise.all([
		cfAll(`/accounts/${z.account}/subscriptions`, ctx.key),
		cfSoft(`/accounts/${z.account}/billing/profile`, ctx.key),
	]);
	const p = rec(profile);
	return view({
		tables: [
			table(
				'Subscriptions',
				[col('what', 'Product'), col('plan', 'Plan'), col('price', 'Price', true), col('next', 'Renews', true)],
				(subs ?? []).map((s) =>
					row(str(s['id']), str(rec(s['rate_plan'])['public_name']), {
						what: str(rec(s['product'])['name']) || str(rec(s['rate_plan'])['id']),
						plan: str(rec(s['rate_plan'])['public_name']),
						price: `${usd(num(s['price']))} ${str(s['frequency'])}`,
						next: when(str(s['current_period_end'])),
					}),
				),
				subs
					? 'No paid subscriptions: everything is on free plans.'
					: 'Subscriptions are not readable with this key (it needs Billing read).',
			),
		],
		facts: profile
			? [
					fact('Billing contact', `${str(p['first_name'])} ${str(p['last_name'])}`.trim() || '—'),
					fact(
						'Payment method',
						str(p['payment_gateway']) ? `${str(p['payment_gateway'])} on file` : 'none on file',
					),
				]
			: [],
		notes: [note('Cards are added and changed on Cloudflare’s own billing page, never in the console.', 'muted')],
		links: [{ label: 'Billing on Cloudflare', url: `https://dash.cloudflare.com/${z.account}/billing` }],
	});
};

/* ----- Run › Secrets › Write (GitHub environment secret) ----- */

export const secretsWriteScreen: ProductScreen = {
	vendor: 'github',
	tabs: {},
};
const secretWrite: ProductFormSpec = {
	async read(ctx) {
		const envs = arr(
			rec(
				await fetch(`${GH}/repos/${ctx.repository}/environments`, {
					headers: { authorization: `Bearer ${ctx.key}`, 'user-agent': 'release-console' },
					signal: AbortSignal.timeout(15_000),
				})
					.then((r) => r.json())
					.catch(() => ({})),
			)['environments'],
		).map(rec);
		const names = ['DEPLOY_SSH_KEY', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'INFISICAL_CLIENT_SECRET'];
		return formTab(
			form({
				key: 'write',
				title: 'Write a secret into a GitHub environment',
				submit: 'Write secret',
				fields: [
					field('environment', 'Environment', 'select', {
						options: [...new Set(['staging', 'production', ...envs.map((e) => str(e['name']))])].map((e) =>
							option(e, e),
						),
						value: 'staging',
					}),
					field('name', 'Name', 'select', {
						options: [...names.map((n) => option(n, n)), option('other', 'Another name…')],
						value: names[1] as string,
					}),
					field('other', 'Other name', 'text', {
						help: 'CAPITAL_LETTERS_AND_DIGITS, only when Another name is chosen.',
					}),
					field('value', 'Value', 'secret', {
						required: true,
						help: 'Typed into a hidden box, sent once to GitHub through the Mac helper, never kept or shown again.',
					}),
				],
				confirmName: null,
				notes: [
					note(
						'The value goes from this page to the console API, to the Mac helper, to gh secret set on its standard input: it never appears on a command line, in a log or in the audit (which keeps the name only).',
						'cy',
					),
				],
			}),
		);
	},
	async send(ctx, w) {
		const env = text(w, 'environment');
		const chosen = text(w, 'name');
		const name = chosen === 'other' ? text(w, 'other') : chosen;
		if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) throw new VendorError('Name: capital letters, digits and _.', 400);
		const value = typeof w.values['value'] === 'string' ? w.values['value'] : '';
		if (!value.trim()) throw new VendorError('Type the value.', 400);
		await ctx.helper('POST', '/github/environment', {
			repository: ctx.repository,
			environment: env,
			variables: {},
			secrets: { [name]: value },
		});
		return { message: `${name} written into GitHub environment ${env}`, productId: name, follow: [] };
	},
};

/** Adds the remaining tabs and forms to the screens they belong to. */
export function addExtras(screens: Record<string, ProductScreen>): void {
	// Every screen named here is registered before the extras are added (registry.ts).
	const screen = (name: string) => screens[name] as ProductScreen;
	addForm(screen('doautoscale'), 'op', autoscaleOp);
	addForm(screen('apps'), 'create', appCreate);
	addForm(screen('registry'), 'edit', registryEdit);
	addForm(screen('donetadv'), 'edit', peeringEdit);
	addForm(screen('loadbalancers'), 'op', lbMembers);
	addForm(screen('inference'), 'create', agentCreate);
	addForm(screen('spaces'), 'create', bucketCreate);
	addForm(screen('spaces'), 'destroy', bucketDestroy);
	addForm(screen('spaces'), 'op', keyRotate);
	addForm(screen('functions'), 'op', {
		read: async () =>
			formTab(
				form({
					key: 'op',
					title: 'Deploy functions',
					submit: 'Deploy',
					blocked:
						'Functions are deployed from code with doctl serverless deploy (in the repository’s pipeline); the console shows what is deployed and its triggers.',
				}),
			),
		async send() {
			throw new VendorError('Functions deploy from code.', 400);
		},
	});
	const secrets = screen('dosecrets');
	{
		secrets.tabs['detail'] = async (ctx) => {
			const apps = await appsWithSecrets(ctx);
			const p = pick(
				'App',
				apps.map((a) => ({ value: str(a['id']), label: str(rec(a['spec'])['name']) })),
				ctx.id,
			);
			const a = apps.find((x) => str(x['id']) === p.value);
			if (!a)
				return view({
					notes: [
						note(
							'No App Platform app holds secrets. This project’s secrets are in Infisical (Run › Secrets).',
							'cy',
						),
					],
				});
			const envs = [
				...arr(rec(a['spec'])['envs']),
				...arr(rec(a['spec'])['services']).flatMap((c) => arr(rec(c)['envs'])),
			]
				.map(rec)
				.filter((e) => str(e['type']) === 'SECRET');
			return view(
				{
					head: { name: str(rec(a['spec'])['name']), status: `${envs.length} secrets`, tone: 'cy' },
					tables: [
						table(
							'Secret names (never values)',
							[col('name', 'Name', true), col('scope', 'Used at')],
							envs.map((e) =>
								row(str(e['key']), str(e['key']), { name: str(e['key']), scope: str(e['scope']) }),
							),
							'None.',
						),
					],
				},
				p,
			);
		};
		for (const k of ['create', 'edit', 'destroy']) addForm(secrets, k, inInfisical(k));
		secrets.tabs['history'] = async (ctx) => {
			const apps = await appsWithSecrets(ctx);
			return view({
				tables: [
					table(
						'When apps holding secrets last changed',
						[col('at', 'When', true), col('app', 'App')],
						apps.map((a) =>
							row(str(a['id']), str(rec(a['spec'])['name']), {
								at: when(str(a['updated_at'])),
								app: str(rec(a['spec'])['name']),
							}),
						),
						'No apps hold secrets.',
					),
				],
				notes: [
					note(
						'Infisical keeps each secret’s versions and who changed it; Run › Secrets shows the dates.',
						'muted',
					),
				],
			});
		};
	}
	screen('cfaccount').tabs['billing'] = cfBilling;
	screens['secrets'] = { ...secretsWriteScreen, tabs: { write: secretWrite.read }, forms: { write: secretWrite } };
}
