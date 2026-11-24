/**
 * Environment tags for cloud resources (owner, 23 Nov, "Yes, as planned"): pages without the
 * Local / Staging / Production switch show every environment's resources, each labelled with the
 * environment it belongs to. The owner tags a droplet, database, bucket, cluster or app with one of
 * the repository's own environments (read from the console's database, so a new "Development" shows
 * up by itself); the tag lives in the console's database and goes when the resource is destroyed.
 */
import { type ProductCell, envOfHosts, envOfText, hostsIn } from '@saha-textile/release-console-contracts';

import type { ProductCtx, ProductFormSpec, ProductScreen } from './kit.js';
import { action, col, field, form, formTab, note, option, pick } from './kit.js';
import { type ScreenExtra } from './cf-zone-more.js';
import { doAll, dropletsOf } from './do-kit.js';
import { buckets } from './do-services.js';
import { VendorError, num, rec, str } from '../vendors/http.js';

export type TagKind = 'droplet' | 'database' | 'spaces' | 'k8s' | 'app';
type Item = { id: string; name: string };

const LISTS: Record<TagKind, (ctx: ProductCtx, key: string) => Promise<Item[]>> = {
	droplet: async (_c, k) => (await dropletsOf(k)).map((d) => ({ id: String(num(d['id'])), name: str(d['name']) })),
	database: async (_c, k) =>
		(await doAll('/databases', 'databases', k)).map((d) => ({ id: str(d['id']), name: str(d['name']) })),
	spaces: async (ctx) => (await buckets(ctx)).map((b) => ({ id: b.name, name: b.name })),
	k8s: async (_c, k) =>
		(await doAll('/kubernetes/clusters', 'kubernetes_clusters', k)).map((c) => ({
			id: str(c['id']),
			name: str(c['name']),
		})),
	app: async (_c, k) =>
		(await doAll('/apps', 'apps', k)).map((a) => ({ id: str(a['id']), name: str(rec(a['spec'])['name']) })),
};
const NOUN: Record<TagKind, string> = {
	droplet: 'server',
	database: 'database',
	spaces: 'bucket',
	k8s: 'cluster',
	app: 'app',
};

/** The environment a resource is tagged with, or null. */
export const envOf = (ctx: ProductCtx, kind: TagKind, id: string): string | null =>
	ctx.envTags()[`do:${kind}:${id}`] ?? null;

export function envTagForm(kind: TagKind): ProductFormSpec {
	return {
		async read(ctx) {
			const items = await LISTS[kind](ctx, ctx.key);
			// Buckets may come from a partial fallback list (no S3 listing right), so they are not pruned here.
			if (kind !== 'spaces' && items.length < 2000)
				ctx.pruneEnvTags(
					kind,
					items.map((i) => i.id),
				);
			const tags = ctx.envTags();
			const envs = ctx.repo.environments;
			const p = pick(
				NOUN[kind],
				items.map((it) => ({
					value: it.id,
					label: `${it.name} · ${tags[`do:${kind}:${it.id}`] ?? 'no environment'}`,
				})),
				ctx.id,
			);
			const now = p.value ? (tags[`do:${kind}:${p.value}`] ?? '') : '';
			return formTab(
				form({
					key: 'envtag',
					title: `Which environment is this ${NOUN[kind]} for?`,
					submit: 'Save',
					blocked: items.length ? null : `No ${NOUN[kind]}s yet.`,
					fields: [
						field('env', 'Environment', 'select', {
							value: now,
							options: [
								option('', 'No environment'),
								...envs.map((e) => option(e.name, e.label || e.name)),
							],
						}),
					],
					notes: [
						note(
							'The tag lives in the console; it labels this resource on every page and goes when it is destroyed.',
							'muted',
						),
					],
				}),
				p,
			);
		},
		async send(ctx, w) {
			await ctx.writeKey();
			const id = w.id ?? ctx.id;
			const it = (await LISTS[kind](ctx, ctx.key)).find((x) => x.id === id);
			if (!it) throw new VendorError(`Choose a ${NOUN[kind]}.`, 400);
			const env = typeof w.values['env'] === 'string' && w.values['env'] ? w.values['env'] : null;
			ctx.setEnvTag(`do:${kind}:${it.id}`, env);
			return { message: `${it.name}: ${env ?? 'no environment'}`, productId: it.id, follow: [] };
		},
	};
}

/** A Tag environment tab and form; the button goes on `buttonOn` (resource lists draw their own). */
export const envTagExtra = (kind: TagKind, buttonOn?: string): ScreenExtra => ({
	tabs: { envtag: (ctx) => envTagForm(kind).read(ctx) },
	forms: { envtag: envTagForm(kind) },
	...(buttonOn ? { buttons: { [buttonOn]: [action('Tag environment', 'envtag')] } } : {}),
});

/** What a row's environment is worked out from: the text of some of its cells. */
type LabelFrom = { hosts: string[] } | { text: string[] };
/** Per tab, per table (its title starts with the key): which cells hold hosts or text naming one. */
export type EnvLabelSpec = Record<string, Record<string, LabelFrom>>;

const cellText = (cells: Record<string, ProductCell>, keys: string[]) =>
	keys.map((k) => (cells[k] === null || cells[k] === undefined ? '' : String(cells[k]))).join(' ');

/**
 * Adds an Environment column to tables whose rows name hosts (DNS, tunnels, Access, routes,
 * certificates, rules) or environments (the audit log), worked out from the repository's own
 * environments and domains (owner, 23 Nov: labels on pages without the switch).
 */
export function withEnvLabels(screen: ProductScreen, spec: EnvLabelSpec): ProductScreen {
	const tabs = { ...screen.tabs };
	for (const [tabKey, tables] of Object.entries(spec)) {
		const base = tabs[tabKey];
		if (!base) continue;
		tabs[tabKey] = async (ctx) => {
			const t = await base(ctx);
			if (t.type !== 'view') return t;
			const envs = ctx.repo.environments;
			return {
				...t,
				view: {
					...t.view,
					tables: t.view.tables.map((tb) => {
						const from = Object.entries(tables).find(([title]) => tb.title.startsWith(title))?.[1];
						if (!from || tb.columns.some((c) => c.key === 'env')) return tb;
						return {
							...tb,
							columns: [...tb.columns, col('env', 'Environment')],
							rows: tb.rows.map((r) => ({
								...r,
								cells: {
									...r.cells,
									env:
										('hosts' in from
											? envOfHosts(envs, hostsIn(cellText(r.cells, from.hosts)))
											: envOfText(envs, cellText(r.cells, from.text))) ?? '—',
								},
							})),
						};
					}),
				},
			};
		};
	}
	return { ...screen, tabs };
}

/** The Cloudflare and Governance screens that list environment-bound rows. */
export const ENV_LABELS: Record<string, EnvLabelSpec> = {
	cfzt: {
		tunnels: { Tunnels: { hosts: ['hosts'] } },
		access: { 'Access applications': { hosts: ['domain'] } },
		apps: { 'Access applications': { hosts: ['domain'] } },
	},
	cfaccess: { list: { 'Access applications': { hosts: ['domain'] } } },
	cfroutes: { list: { 'Workers routes': { hosts: ['pattern'] } } },
	cfssl: {
		edge: { 'Edge certificates': { hosts: ['hosts'] } },
		origin: { 'Origin certificates': { hosts: ['hosts'] } },
		hostnames: { 'Custom hostnames': { hosts: ['host'] } },
	},
	cfrules: {
		overview: {
			'Redirect rules': { hosts: ['expr'] },
			'URL rewrite rules': { hosts: ['expr'] },
			'Request header rules': { hosts: ['expr'] },
			'Response header rules': { hosts: ['expr'] },
			'Origin rules': { hosts: ['expr'] },
			'Configuration rules': { hosts: ['expr'] },
			'Compression rules': { hosts: ['expr'] },
			'Page rules': { hosts: ['targets'] },
		},
	},
	audit: { list: { 'Every action in this console': { text: ['detail'] } } },
};
