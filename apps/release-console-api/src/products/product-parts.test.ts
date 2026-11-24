import { afterEach, describe, expect, it, vi } from 'vitest';

import { cfFeatures } from './cf-plan.js';
import { envOf, envTagForm, withEnvLabels } from './env-tags.js';
import { type ProductCtx, type ProductScreen, view } from './kit.js';
import { runLoad } from './loadtest.js';
import { productionBackup } from './production-backup.js';
import { type ResourceSpec, resource } from './resource.js';

/** Vendors answer locally by address; the first matching route wins. */
type Route = [RegExp, number, unknown];
function vendor(routes: Route[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${url}`;
			const hit = routes.find(([re]) => re.test(line));
			if (!hit) return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
			return new Response(JSON.stringify(hit[2]), { status: hit[1] });
		}),
	);
}
let n = 0;
const ctx = (over: Partial<ProductCtx> = {}): ProductCtx =>
	({
		key: `parts-key-${++n}`,
		zones: ['example.com'],
		id: null,
		range: '24h',
		writeKey: async () => 'write-key',
		repo: { environments: [{ name: 'staging', label: 'Staging', domains: ['staging.example.com'] }] },
		envTags: () => ({ 'do:droplet:1': 'staging' }),
		setEnvTag: vi.fn(),
		pruneEnvTags: vi.fn(),
		...over,
	}) as unknown as ProductCtx;
const write = (values: Record<string, unknown> = {}, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the load test', () => {
	it('counts requests, server errors and failures, and answers zeros for no time at all', async () => {
		let i = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				i += 1;
				if (i % 3 === 0) throw new Error('refused');
				return new Response('ok', { status: i % 2 ? 503 : 200 });
			}),
		);
		const result = await runLoad('https://staging.example.test', [], 2, 0.2);
		expect(result.requests).toBeGreaterThan(0);
		expect(result.errors).toBeGreaterThan(0);
		expect(await runLoad('https://staging.example.test', ['/'], 1, 0)).toEqual({
			requests: 0,
			errors: 0,
			p50: 0,
			p95: 0,
		});
	});
});

describe('the Cloudflare plan', () => {
	it('reads features from the plan and subscriptions, and keeps going past reads that fail', async () => {
		vendor([
			[
				/zones\?name=/,
				200,
				{
					success: true,
					result: [{ id: 'z1', name: 'example.com', account: { id: 'a1' }, plan: { legacy_id: 'pro' } }],
				},
			],
			[/zones\/z1\/subscription/, 500, { errors: [{ message: 'Boom' }] }],
			[
				/accounts\/a1\/subscriptions/,
				200,
				{
					success: true,
					result: [
						{ rate_plan: { id: 'x' }, component_values: [{ name: 'argo', value: 1 }, { name: 'stream' }] },
					],
				},
			],
			[/argo/, 500, {}],
			[/cache_reserve/, 500, {}],
			[/r2/, 500, {}],
		]);
		const features = await cfFeatures(ctx());
		expect(features).toMatchObject({
			'cf.pro': true,
			'cf.business': false,
			'cf.argo': true,
			'cf.stream': false,
			'cf.r2': false,
		});
		vendor([
			[
				/zones\?name=/,
				200,
				{ success: true, result: [{ id: 'z1', name: 'example.com', account: { id: 'a1' }, plan: {} }] },
			],
			[/subscriptions/, 500, {}],
		]);
		expect((await cfFeatures(ctx()))['cf.pro']).toBe(false);
	});
});

describe('environment tags', () => {
	it('reads a resource’s tag, tags the one in the address, and labels only tabs the screen has', async () => {
		expect(envOf(ctx(), 'droplet', '1')).toBe('staging');
		expect(envOf(ctx(), 'droplet', '2')).toBeNull();
		vendor([[/droplets/, 200, { droplets: [{ id: 1, name: 'web' }] }]]);
		const c = ctx({ id: '1' });
		const sent = await envTagForm('droplet').send(c, write({ env: '' }));
		expect(sent.message).toBe('web: no environment');
		expect(c.setEnvTag).toHaveBeenCalledWith('do:droplet:1', null);
		const screen: ProductScreen = {
			vendor: 'cloudflare',
			tabs: {
				dns: async () =>
					view({
						tables: [
							{
								title: 'Records',
								columns: [{ key: 'name', label: 'Name', mono: false }],
								rows: [{ id: 'r', name: 'r', cells: { name: null }, tone: null }],
								empty: '',
								opens: false,
							},
						],
					}),
			},
		};
		const labelled = withEnvLabels(screen, {
			dns: { Records: { hosts: ['name'] } },
			missing: { X: { text: ['x'] } },
		});
		const tab = await labelled.tabs['dns']?.(ctx());
		expect(JSON.stringify(tab)).toContain('Environment');
		expect(labelled.tabs['missing']).toBeUndefined();
	});
});

describe('a resource screen', () => {
	const widget = (id: string, over: Record<string, unknown> = {}) => ({
		id,
		name: `w${id}`,
		status: 'active',
		size: null,
		...over,
	});
	const rich: ResourceSpec = {
		vendor: 'digitalocean',
		noun: 'widget',
		nouns: 'widgets',
		items: async () => [widget('1'), widget('2', { size: 3 })],
		id: (i) => String(i['id']),
		name: (i) => String(i['name']),
		status: (i) => String(i['status']),
		columns: [['size', 'Size', true, (i) => (i['size'] as number | null) ?? null]],
		empty: 'No widgets.',
		one: async (_c, id) => widget(id),
		envTag: 'droplet',
		listActions: [['Do it', 'doit']],
		create: {
			title: 'Create',
			submit: 'Create',
			fields: () => [],
			cost: () => '$5',
			notes: () => [],
			blocked: () => null,
			send: async () => ({ message: 'created', productId: '3' }),
		},
		edit: {
			title: 'Edit',
			submit: 'Save',
			fields: async () => [],
			send: async () => ({ message: 'saved', productId: null }),
		},
		op: {
			title: 'Restart',
			submit: 'Restart',
			fields: () => [],
			send: async () => ({ message: 'restarted', productId: null }),
		},
		destroy: { remove: async () => undefined },
		monitor: async () => ({ series: [] }),
		backup: { view: async () => ({ type: 'jobs' }) },
		history: async () => [
			{ at: '2026-11-24T00:00:00Z', what: 'made', state: 'done' },
			{ at: '', what: 'seen' },
		],
	};
	const bare: ResourceSpec = {
		vendor: 'cloudflare',
		noun: 'thing',
		nouns: 'things',
		items: async () => [],
		id: (i) => String(i['id']),
		name: (i) => String(i['name']),
		columns: [],
		empty: 'None.',
		envFrom: () => 'Staging',
		facts: () => [],
		links: () => [],
		tables: async () => [],
		backup: { none: 'Nothing to back up.' },
		op: {
			label: 'Rotate',
			title: 'Rotate',
			submit: 'Rotate',
			fields: () => [],
			send: async () => ({ message: 'x', productId: null }),
		},
		destroy: { submit: 'Remove', remove: async () => ({ message: 'removed', productId: null }) },
		monitor: async () => ({ series: [], notes: [] }),
	};

	it('draws every tab for an account with items, and for one with none', async () => {
		const screen = resource(rich);
		for (const tab of ['list', 'detail', 'create', 'edit', 'op', 'destroy', 'monitor', 'backup', 'history'])
			expect(await screen.tabs[tab]?.(ctx({ id: '1' }))).toBeTruthy();
		const empty = resource(bare);
		for (const tab of ['list', 'detail', 'op', 'destroy', 'monitor', 'backup', 'history'])
			expect(await empty.tabs[tab]?.(ctx())).toBeTruthy();
		const withThing = resource({
			...bare,
			items: async () => [{ id: 't', name: 'thing' }],
			backup: { view: async () => view({}) },
		});
		expect(JSON.stringify(await withThing.tabs['detail']?.(ctx()))).toContain('Staging');
		expect(((await withThing.tabs['backup']?.(ctx())) as { picker: unknown }).picker).toBeTruthy();
		// A plain list with no changes to offer, and charts with measurements.
		const plain = resource({
			...bare,
			items: async () => [{ id: 't', name: 'thing' }],
			envFrom: undefined,
			op: undefined,
			destroy: undefined,
			monitor: async () => ({ series: [{ name: 'CPU', unit: '%', points: [[1, 2]] }] }),
		});
		expect(JSON.stringify(await plain.tabs['detail']?.(ctx()))).not.toContain('Destroy');
		expect(plain.forms?.['destroy']).toBeUndefined();
		expect(((await plain.tabs['monitor']?.(ctx())) as { monitor: { notes: unknown[] } }).monitor.notes).toEqual([]);
	});

	it('sends each form for the item asked for, and refuses a missing or mistyped one', async () => {
		const screen = resource(rich);
		await expect(screen.forms?.['edit']?.send(ctx(), write())).rejects.toThrow('Choose a widget.');
		await expect(screen.forms?.['edit']?.send(ctx(), write({}, '9'))).rejects.toThrow(
			'No widget 9 on the account any more.',
		);
		expect((await screen.forms?.['edit']?.send(ctx({ id: '1' }), write()))?.message).toBe('saved');
		await expect(screen.forms?.['destroy']?.send(ctx(), write({}, '1', 'wrong'))).rejects.toThrow();
		const c = ctx();
		expect((await screen.forms?.['destroy']?.send(c, write({}, '1', 'w1')))?.message).toBe('Widget w1 deleted');
		expect(c.setEnvTag).toHaveBeenCalledWith('do:droplet:1', null);
		expect((await screen.forms?.['create']?.send(ctx(), write()))?.message).toBe('created');
		const plain = resource({ ...bare, items: async () => [{ id: 't', name: 'thing' }] });
		expect((await plain.forms?.['destroy']?.send(ctx(), write({}, 't', 'thing')))?.message).toBe('removed');
	});
});

describe('the production backup a rehearsal restores', () => {
	it('is not ready until the nightly backup job exists', async () => {
		expect(await productionBackup({} as ProductCtx)).toEqual({
			ready: false,
			detail: 'the nightly database backup starts with the production server',
		});
	});
});
