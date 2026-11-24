import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Follow, type ProductCtx, type ProductScreen, view } from './kit.js';
import { ProductsService, keySlot } from './products.service.js';
import { PRODUCT_SCREENS } from './registry.js';
import { VendorError } from '../vendors/http.js';

import type { KeySourceService } from '../keys/key-source.js';
import type { RequestLog } from '../local/request-log.js';
import type { ProjectsService } from '../projects/projects.service.js';
import type { ConsoleStore } from '../store/console-store.js';
import type { KeyRef, Repository } from '@saha-textile/release-console-contracts';

/** A screen made for these tests only, registered beside the real ones while they run. */
const seen: Record<string, unknown> = {};
let follow: Follow[] = [];
const TEST_SCREEN: ProductScreen = {
	vendor: 'digitalocean',
	tabs: {
		all: async (ctx: ProductCtx) => {
			seen['consoleKey'] = ctx.consoleKey('CONSOLE_X');
			seen['envTags'] = ctx.envTags();
			ctx.setEnvTag('do:droplet:1', 'staging');
			ctx.pruneEnvTags('droplet', ['1']);
			seen['recent'] = ctx.recent('a');
			seen['recentAll'] = ctx.recentAll('a');
			seen['localRequests'] = ctx.localRequests(60);
			seen['localView'] = ctx.localView(60);
			seen['helper'] = await ctx.helper('GET', '/x');
			seen['auditLog'] = ctx.auditLog(5);
			seen['zones'] = ctx.zones;
			seen['writeKey'] = await ctx.writeKey().catch((err: Error) => err.message);
			return view({});
		},
		refused: async () => {
			throw new VendorError('Not allowed (403).', 403);
		},
		broken: async () => {
			throw new Error('socket hang up');
		},
	},
	forms: {
		make: {
			read: async () => view({}),
			send: async (_ctx, w) => {
				if (w.confirm === 'refuse') throw new VendorError('Name taken.', 422);
				if (w.confirm === 'break') throw new Error('timeout');
				return { message: 'made web-1', productId: w.id, follow };
			},
		},
	},
};
const LOCAL_SCREEN: ProductScreen = {
	vendor: 'local',
	tabs: {
		zones: async (ctx) =>
			view({
				notes: [
					{
						text: `${ctx.zones.join(',')} ${await ctx.writeKey()}|${ctx.consoleKey('NONE') ?? 'none'}`,
						tone: 'cy',
					},
				],
			}),
	},
	forms: { quiet: { read: async () => view({}), send: async () => ({ message: 'checked', productId: null }) } },
};
const GH_SCREEN: ProductScreen = {
	vendor: 'github',
	tabs: { key: async (ctx) => view({ notes: [{ text: await ctx.writeKey(), tone: 'cy' }] }) },
};

const ref = (id: string, kind: string): KeyRef =>
	({ id, kind, label: id, envNames: [`ENV_${id}`] }) as unknown as KeyRef;
const REPO = {
	sourceCode: { vendor: 'github', repository: 'example/shop', keyId: null },
	cloud: [{ id: 'do', vendor: 'digitalocean', keyIds: ['dr', 'dc'] }],
	edge: [{ id: 'cf', vendor: 'cloudflare', keyIds: [], zones: ['example.com'] }],
} as unknown as Repository;

function make(options: { repo?: unknown; keys?: KeyRef[]; values?: Record<string, string | null> } = {}) {
	const values = options.values ?? { dr: 'read-key', dc: 'change-key', gh: 'gh-key' };
	const projects = {
		repository: () => ({
			project: {
				keys: options.keys ?? [ref('dr', 'do-read'), ref('dc', 'do-change'), ref('gh', 'github-token')],
			},
			repo: options.repo ?? REPO,
		}),
		valueOf: async (r: KeyRef) => values[r.id] ?? null,
		envTags: () => ({ 'do:droplet:1': 'staging' }),
		setEnvTag: vi.fn(),
		pruneEnvTags: vi.fn(),
	} as unknown as ProjectsService;
	const store = {
		audit: vi.fn(),
		auditEntries: () => [
			{ at: 't', projectId: 'p', action: 'a', detail: 'd' },
			{ at: 't', projectId: 'p', action: 'b', detail: 'd' },
		],
	} as unknown as ConsoleStore & { audit: ReturnType<typeof vi.fn> };
	const keyFile = { get: (name: string) => (name === 'CONSOLE_X' ? 'x' : null) } as unknown as KeySourceService;
	const requests = { view: () => ({ series: [[1, 2, 0, 3]] }) } as unknown as RequestLog;
	const service = new ProductsService(projects, store, keyFile, requests);
	Object.assign(service, { helper: { call: vi.fn(async () => ({ ok: true })) } });
	return { service, store };
}
const write = (confirm = '', id: string | null = 'web-1') => ({ pin: '123456', confirm, id, values: {} });

beforeEach(() => {
	PRODUCT_SCREENS['test-screen'] = TEST_SCREEN;
	PRODUCT_SCREENS['test-local'] = LOCAL_SCREEN;
	PRODUCT_SCREENS['test-github'] = GH_SCREEN;
	follow = [];
	for (const k of Object.keys(seen)) delete seen[k];
});
afterEach(() => {
	delete PRODUCT_SCREENS['test-screen'];
	delete PRODUCT_SCREENS['test-local'];
	delete PRODUCT_SCREENS['test-github'];
	vi.useRealTimers();
});

describe('where a screen’s keys are linked', () => {
	it('finds the slot for each vendor', () => {
		const keys = [ref('gh', 'github-token'), ref('x', 'do-read')];
		expect(keySlot('github', { ...REPO, sourceCode: { vendor: 'gitlab' } } as never, keys)).toBeUndefined();
		expect(keySlot('github', { ...REPO, sourceCode: { vendor: 'github', keyId: 'own' } } as never, keys)).toEqual({
			keyIds: ['own'],
		});
		expect(keySlot('github', REPO, keys)).toEqual({ keyIds: ['gh'] });
		expect(keySlot('cloudflare', REPO, keys)).toMatchObject({ zones: ['example.com'] });
		expect(keySlot('digitalocean', REPO, keys)).toMatchObject({ id: 'do' });
	});
});

describe('the products service: reading', () => {
	it('lists every screen, and refuses a screen, tab or form it does not have', async () => {
		const { service } = make();
		expect(service.catalogue()['test-screen']).toEqual({
			tabs: ['all', 'refused', 'broken'],
			forms: ['make'],
			vendor: 'digitalocean',
		});
		await expect(service.tab('p', 'r', 'nope', 'all', null, undefined)).rejects.toThrow('No live screen nope.');
		await expect(service.tab('p', 'r', 'test-screen', 'nope', null, undefined)).rejects.toThrow(
			'has no live tab nope',
		);
		await expect(service.form('p', 'r', 'test-screen', 'nope', null)).rejects.toThrow('has no form nope');
		await expect(service.send('p', 'r', 'test-screen', 'nope', write())).rejects.toThrow('has no form nope');
	});

	it('gives a tab everything it reads with, and words a refusal or a failure', async () => {
		const { service } = make();
		expect((await service.tab('p', 'r', 'test-screen', 'all', 'id-1', 'nonsense')).state).toBe('ok');
		expect(seen).toMatchObject({
			consoleKey: 'x',
			envTags: { 'do:droplet:1': 'staging' },
			recent: [expect.objectContaining({ action: 'a' })],
			localRequests: [[1, 2, 0, 3]],
			helper: { ok: true },
			zones: [],
			writeKey: 'change-key',
		});
		expect(await service.tab('p', 'r', 'test-screen', 'refused', null, '24h')).toEqual({
			state: 'error',
			message: 'Not allowed (403).',
		});
		expect(await service.tab('p', 'r', 'test-screen', 'broken', null, '1h')).toEqual({
			state: 'error',
			message: 'The vendor could not be reached: socket hang up',
		});
		expect((await service.form('p', 'r', 'test-screen', 'make', null)).state).toBe('ok');
	});

	it('says what is not connected, and reads this Mac’s screens with the edge’s domains', async () => {
		expect(
			await make({ repo: { ...REPO, cloud: [] } }).service.tab('p', 'r', 'test-screen', 'all', null, undefined),
		).toMatchObject({
			state: 'not-connected',
			message: expect.stringContaining('no DigitalOcean platform'),
		});
		expect((await make({ keys: [] }).service.form('p', 'r', 'test-screen', 'make', null)).state).toBe(
			'not-connected',
		);
		expect(
			(await make({ values: { dr: null } }).service.tab('p', 'r', 'test-screen', 'all', null, undefined)) as {
				message: string;
			},
		).toMatchObject({ message: expect.stringContaining('Add ENV_dr in Infisical') });
		const readOnly = make({ keys: [ref('dr', 'do-read')] });
		await readOnly.service.tab('p', 'r', 'test-screen', 'all', null, undefined);
		expect(seen['writeKey']).toContain('needs its full-access key');
		const changeOnly = make({ keys: [ref('dc', 'do-change')] });
		expect((await changeOnly.service.tab('p', 'r', 'test-screen', 'all', null, undefined)).state).toBe('ok');
		const local = await make().service.tab('p', 'r', 'test-local', 'zones', null, undefined);
		expect(JSON.stringify(local)).toContain('example.com');
		const bare = await make({ repo: { ...REPO, edge: [] } }).service.tab(
			'p',
			'r',
			'test-local',
			'zones',
			null,
			undefined,
		);
		expect(JSON.stringify(bare)).toContain('|none');
		// A form that names no steps to follow finishes at once.
		expect((await make().service.send('p', 'r', 'test-local', 'quiet', write())).state).toBe('done');
		const github = await make().service.tab('p', 'r', 'test-github', 'key', null, undefined);
		expect(JSON.stringify(github)).toContain('gh-key');
	});
});

describe('the products service: sending and following', () => {
	it('records a refusal and a failure, and finishes a change with nothing to follow', async () => {
		const { service, store } = make();
		await expect(service.send('p', 'r', 'test-screen', 'make', write('refuse'))).rejects.toThrow('Name taken.');
		await expect(service.send('p', 'r', 'test-screen', 'make', write('break'))).rejects.toThrow(
			'The vendor could not be reached: timeout',
		);
		expect(store.audit).toHaveBeenCalledWith('p', 'test-screen-make-refused', 'Name taken.');
		const done = await service.send('p', 'r', 'test-screen', 'make', write('', null));
		expect(done).toMatchObject({ state: 'done', message: 'Done.' });
		expect(store.audit).toHaveBeenLastCalledWith('p', 'test-screen-make', 'made web-1');
		await expect(make({ keys: [] }).service.send('p', 'r', 'test-screen', 'make', write())).rejects.toThrow(
			'not connected',
		);
		const readOnly = make({ keys: [ref('dr', 'do-read')] });
		follow = [];
		expect((await readOnly.service.send('p', 'r', 'test-screen', 'make', write())).state).toBe('done');
	});

	it('follows each step until it is done, notes what it found, and lists the changes newest first', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
		let polls = 0;
		follow = [
			{ label: 'Created', check: async () => ++polls > 1, detail: () => 'web-1 is up' },
			{ label: 'Tagged', check: async () => true },
		];
		const { service } = make();
		const job = await service.send('p', 'r', 'test-screen', 'make', write());
		expect(job.state).toBe('running');
		await vi.advanceTimersByTimeAsync(3000);
		await vi.waitFor(() => expect(service.list('p', 'r', 'test-screen')[0]?.state).toBe('done'));
		expect(service.list('p', 'r', 'test-screen')[0]?.steps.map((s) => s.detail)).toEqual([
			'made web-1',
			'web-1 is up',
			'',
		]);
		follow = [{ label: 'Second', check: async () => true }];
		await vi.advanceTimersByTimeAsync(1000);
		await service.send('p', 'r', 'test-screen', 'make', write());
		await vi.waitFor(() =>
			expect(service.list('p', 'r', 'test-screen').every((j) => j.state === 'done')).toBe(true),
		);
		expect(service.list('p', 'r', 'test-screen')).toHaveLength(2);
		expect(service.list('p', 'other', 'test-screen')).toEqual([]);
	});

	it('stops at a step that fails, and gives up after half an hour', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
		const { service, store } = make();
		follow = [{ label: 'Created', check: async () => Promise.reject(new VendorError('Droplet errored.', 500)) }];
		await service.send('p', 'r', 'test-screen', 'make', write());
		follow = [{ label: 'Created', check: async () => Promise.reject(new Error('lost')) }];
		await service.send('p', 'r', 'test-screen', 'make', write());
		follow = [{ label: 'Waiting', check: async () => false }];
		await service.send('p', 'r', 'test-screen', 'make', write());
		await vi.advanceTimersByTimeAsync(31 * 60_000);
		await vi.waitFor(() =>
			expect(service.list('p', 'r', 'test-screen').every((j) => j.state === 'failed')).toBe(true),
		);
		const messages = service.list('p', 'r', 'test-screen').map((j) => j.message);
		expect(messages).toEqual(
			expect.arrayContaining([
				'Stopped at "Created": Droplet errored.',
				'Stopped at "Created": lost',
				expect.stringContaining('after 30 minutes'),
			]),
		);
		expect(store.audit).toHaveBeenCalledWith('p', 'test-screen-make-failed', 'made web-1: Droplet errored.');
	});

	it('does nothing for a job it does not hold, and stops at steps it has no line for', async () => {
		const { service } = make();
		const inside = service as unknown as { run(id: string): Promise<void>; jobs: Map<string, unknown> };
		await inside.run('missing');
		inside.jobs.set('short', {
			job: { state: 'running', steps: [{ state: 'done' }], screen: 'test-screen' },
			projectId: 'p',
			repoId: 'r',
			follow: [{ label: 'x', check: async () => true }],
			key: 'k',
		});
		await inside.run('short');
		expect((inside.jobs.get('short') as { job: { state: string } }).job.state).toBe('done');
	});
});
