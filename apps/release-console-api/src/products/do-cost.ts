/**
 * DigitalOcean changes that add to the bill (owner, 23 Nov: build them "with proper functionality";
 * standing rule: the price is shown before the PIN). Droplet backups, database read replicas,
 * Kubernetes node pools, and the Spaces CDN (free, kept here with its neighbours).
 */
import type { ProductTab, ProductWrite } from '@saha-textile/release-console-contracts';

import type { ProductCtx, ProductFormSpec } from './kit.js';
import { action, bool, field, form, formTab, note, option, pick, text } from './kit.js';
import { type ScreenExtra } from './cf-zone-more.js';
import { doAll, doGet, doSend, dropletsOf } from './do-kit.js';
import { VendorError, num, rec, str } from '../vendors/http.js';

const opt = (w: ProductWrite, key: string) => {
	const v = w.values[key];
	return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
};
const usd = (n: number) => `$${n.toFixed(2)}`;

const backups: ProductFormSpec = {
	async read(ctx) {
		const ds = await dropletsOf(ctx.key);
		const p = pick(
			'Server',
			ds.map((d) => ({ value: String(num(d['id'])), label: str(d['name']) })),
			ctx.id,
		);
		const d = ds.find((x) => String(num(x['id'])) === p.value);
		const price = num(rec(d?.['size'])['price_monthly']);
		const on = Array.isArray(d?.['backup_ids']) && (d?.['features'] as unknown[] | undefined)?.includes('backups');
		return formTab(
			form({
				key: 'backups',
				title: 'Weekly backups',
				submit: on ? 'Turn backups off' : 'Turn backups on',
				blocked: d ? null : 'No servers yet.',
				cost:
					d && !on
						? `Backups add 20% of the server’s price: ${usd(price * 0.2)} a month on top of ${usd(price)}.`
						: null,
				fields: [],
				notes: [
					note(
						'Snapshots taken by hand (Back up › Snapshot now) are billed separately, per GB stored.',
						'muted',
					),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const id = w.id ?? ctx.id;
		const d = (await dropletsOf(k)).find((x) => String(num(x['id'])) === id);
		if (!d) throw new VendorError('Choose a server.', 400);
		const on = (d['features'] as unknown[] | undefined)?.includes('backups');
		await doSend('POST', `/droplets/${id}/actions`, k, { type: on ? 'disable_backups' : 'enable_backups' });
		// The server was found by this id.
		return { message: `${str(d['name'])}: backups ${on ? 'off' : 'on'}`, productId: id as string, follow: [] };
	},
};

const replica: ProductFormSpec = {
	async read(ctx) {
		const dbs = await doAll('/databases', 'databases', ctx.key);
		const p = pick(
			'Database cluster',
			dbs.map((d) => ({
				value: str(d['id']),
				label: `${str(d['name'])} · ${str(d['engine'])} · ${str(d['size'])}`,
			})),
			ctx.id,
		);
		const d = dbs.find((x) => str(x['id']) === p.value);
		return formTab(
			form({
				key: 'replica',
				title: 'Add a read replica',
				submit: 'Add replica',
				blocked: d ? null : 'No managed databases yet.',
				cost: d
					? `A read replica is billed as one more node of the size chosen, at that size’s monthly price (the primary is ${str(d['size'])}).`
					: null,
				fields: [
					field('name', 'Replica name', 'text', {
						value: d ? `${str(d['name'])}-replica` : '',
						required: true,
					}),
					field('region', 'Region', 'text', { value: str(d?.['region']), required: true }),
					field('size', 'Size', 'text', {
						value: str(d?.['size']),
						required: true,
						help: 'Like db-s-1vcpu-1gb',
					}),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const id = w.id ?? ctx.id;
		if (!id) throw new VendorError('Choose a database cluster.', 400);
		const name = text(w, 'name');
		if (!/^[a-z0-9-]{3,63}$/.test(name)) throw new VendorError('Name: lowercase letters, digits and -.', 400);
		await doSend('POST', `/databases/${id}/replicas`, k, {
			name,
			region: text(w, 'region'),
			size: text(w, 'size'),
		});
		return { message: `Replica ${name} is being made`, productId: id, follow: [] };
	},
};

const nodePool: ProductFormSpec = {
	async read(ctx) {
		const [clusters, sizes] = await Promise.all([
			doAll('/kubernetes/clusters', 'kubernetes_clusters', ctx.key),
			doAll('/sizes', 'sizes', ctx.key),
		]);
		const p = pick(
			'Cluster',
			clusters.map((c) => ({ value: str(c['id']), label: str(c['name']) })),
			ctx.id,
		);
		const c = clusters.find((x) => str(x['id']) === p.value);
		const avail = sizes.filter(
			(s) =>
				s['available'] === true && (!c || (s['regions'] as unknown[] | undefined)?.includes(str(c['region']))),
		);
		return formTab(
			form({
				key: 'nodepool',
				title: 'Add a node pool',
				submit: 'Add node pool',
				blocked: c ? null : 'No Kubernetes clusters yet.',
				cost: 'Each node is billed at its size’s monthly price (shown beside each size); the total is nodes × price.',
				fields: [
					field('name', 'Pool name', 'text', { required: true }),
					field('size', 'Node size', 'select', {
						value: str(avail[0]?.['slug']),
						options: avail
							.slice(0, 40)
							.map((s) =>
								option(str(s['slug']), `${str(s['slug'])} · $${num(s['price_monthly'])}/month`),
							),
					}),
					field('count', 'Nodes', 'number', { value: 2, min: 1, max: 20 }),
					field('auto', 'Autoscale between min and max', 'toggle', { value: false }),
					field('min', 'Min nodes', 'number', { value: 1, min: 0, max: 20 }),
					field('max', 'Max nodes', 'number', { value: 3, min: 1, max: 20 }),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const id = w.id ?? ctx.id;
		if (!id) throw new VendorError('Choose a cluster.', 400);
		const name = text(w, 'name');
		if (!/^[a-z0-9-]{2,63}$/.test(name)) throw new VendorError('Name: lowercase letters, digits and -.', 400);
		const count = Number(opt(w, 'count') || '2');
		const sizes = await doAll('/sizes', 'sizes', k);
		const size = sizes.find((s) => str(s['slug']) === opt(w, 'size'));
		if (!size) throw new VendorError('Choose a size.', 400);
		await doSend('POST', `/kubernetes/clusters/${id}/node_pools`, k, {
			name,
			size: str(size['slug']),
			count,
			...(bool(w, 'auto')
				? { auto_scale: true, min_nodes: Number(opt(w, 'min') || '1'), max_nodes: Number(opt(w, 'max') || '3') }
				: {}),
		});
		return {
			message: `Node pool ${name}: ${count} × ${str(size['slug'])} (${usd(count * num(size['price_monthly']))}/month)`,
			productId: id,
			follow: [],
		};
	},
};

const cdn: ProductFormSpec = {
	async read(ctx) {
		const [endpoints, buckets] = await Promise.all([
			doAll('/cdn/endpoints', 'endpoints', ctx.key),
			doGet('/spaces/buckets', ctx.key).catch(() => null),
		]);
		const origins = endpoints.map((e) => str(e['origin']));
		return formTab(
			form({
				key: 'cdn',
				title: 'Spaces CDN on or off',
				submit: 'Save',
				fields: [
					field('origin', 'Bucket address', 'text', {
						value: origins[0] ?? '',
						required: true,
						help: 'Like saha-textile-media.sgp1.digitaloceanspaces.com',
					}),
					field('on', 'CDN', 'select', {
						value: origins.length ? 'on' : 'off',
						options: [option('on', 'On'), option('off', 'Off')],
					}),
					field('ttl', 'Cache time (seconds)', 'number', { value: 3600, min: 60, max: 604800 }),
				],
				notes: [
					note(
						`The Spaces CDN costs nothing extra. ${buckets ? '' : 'Bucket list read through the Spaces key on the Spaces screen.'}`.trim(),
						'muted',
					),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const origin = text(w, 'origin');
		if (!/^[a-z0-9-]+\.[a-z0-9]+\.digitaloceanspaces\.com$/.test(origin))
			throw new VendorError('A bucket address like name.sgp1.digitaloceanspaces.com.', 400);
		const endpoints = await doAll('/cdn/endpoints', 'endpoints', k);
		const hit = endpoints.find((e) => str(e['origin']) === origin);
		if (opt(w, 'on') === 'on') {
			if (hit)
				await doSend('PUT', `/cdn/endpoints/${str(hit['id'])}`, k, { ttl: Number(opt(w, 'ttl') || '3600') });
			else await doSend('POST', '/cdn/endpoints', k, { origin, ttl: Number(opt(w, 'ttl') || '3600') });
			return { message: `CDN on for ${origin}`, productId: null, follow: [] };
		}
		if (hit) await doSend('DELETE', `/cdn/endpoints/${str(hit['id'])}`, k);
		return { message: `CDN off for ${origin}`, productId: null, follow: [] };
	},
};

export const DROPLET_COST_EXTRA: ScreenExtra = {
	forms: { backups },
	buttons: { backup: [action('Weekly backups on or off', 'backups')] },
};
export const DB_COST_EXTRA: ScreenExtra = {
	forms: { replica },
	buttons: { list: [action('Add a read replica', 'replica')] },
};
export const K8S_COST_EXTRA: ScreenExtra = {
	forms: { nodepool: nodePool },
	buttons: { list: [action('Add a node pool', 'nodepool')] },
};
export const SPACES_CDN_EXTRA: ScreenExtra = {
	forms: {
		cdnonoff: {
			...cdn,
			read: async (ctx: ProductCtx) => {
				// The CDN form always reads as a form.
				const t = (await cdn.read(ctx)) as Extract<ProductTab, { type: 'form' }>;
				t.form.key = 'cdnonoff';
				return t;
			},
		},
	},
	buttons: { cdn: [action('CDN on or off', 'cdnonoff')] },
};
