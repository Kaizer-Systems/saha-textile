import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FixedAsset, FixedAssetWrite } from '@saha-textile/contracts';
import { ASSET_CATEGORIES, RESIDUAL_PERCENT } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { AssetsController } from '../src/assets/assets.controller';
import { AssetsModule } from '../src/assets/assets.module';
import { ACCUMULATED_LEDGER_NAME, AssetsService } from '../src/assets/assets.service';
import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { LedgerModule } from '../src/ledger/ledger.module';

/** Fixed assets and their monthly depreciation (accounts brief R1–R4). */

const at = '2026-12-01T06:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });
const accountant = { userId: 'adm_acc', permissions: ['accounts.post'] } as never;

const CHART = {
	groups: [{ id: 'g_fa', systemKey: 'fixed_assets' }],
	ledgers: [
		{ id: 'led_furniture', groupId: 'g_fa', name: 'Furniture and fittings', roles: [] },
		{ id: 'led_dep', groupId: 'g_exp', name: 'Depreciation', roles: ['depreciation'] },
	],
};

const write = (over: Partial<FixedAssetWrite> = {}): FixedAssetWrite => ({
	name: 'Billing counter',
	categoryKey: 'furniture',
	locationId: 'loc_bar',
	costINR: 60_000,
	putToUseOn: '2026-04-10',
	method: 'slm',
	lifeMonths: 120,
	residualINR: 0,
	run: 'monthly',
	taxRatePct: 10,
	inputGst: 'claimed',
	reference: 'BILL-9',
	acquisition: { kind: 'post', ledgerId: 'led_hdfc' },
	...over,
});

/** An asset in the register, rupees as kept, paise for what it has taken. */
const asset = (id: string, over: Partial<FixedAsset> = {}): FixedAsset => ({
	name: `Asset ${id}`,
	categoryKey: 'furniture',
	locationId: 'loc_bar',
	costINR: 120_000,
	putToUseOn: '2026-04-10',
	method: 'slm',
	lifeMonths: 120,
	residualINR: 0,
	run: 'monthly',
	taxRatePct: 10,
	inputGst: 'claimed',
	reference: '',
	id,
	tag: `FA-${id}`,
	status: 'active',
	disposedOn: null,
	disposalINR: null,
	accumulatedPaise: 700_000,
	depreciatedThrough: '2026-10',
	assetLedgerId: 'led_furniture',
	acquisitionVoucherId: null,
	createdBy: 'adm_acc',
	createdAt: at,
	updatedAt: at,
	version: 3,
	...over,
});

function build(
	options: {
		assets?: FixedAsset[];
		chart?: unknown;
		posted?: Record<string, { id: string }>;
		insertFails?: unknown;
		saveFails?: unknown;
	} = {},
) {
	const store = new Map((options.assets ?? []).map((a) => [a.id, a]));
	const repo = {
		list: async () => [...store.values()],
		get: async (id: string) => store.get(id) ?? null,
		count: async () => store.size,
		insert: vi.fn(async (next: FixedAsset, _context?: unknown) => {
			if (options.insertFails !== undefined) throw options.insertFails;
			store.set(next.id, next);
		}),
		save: vi.fn(async (next: FixedAsset, expectedVersion: number, _context?: unknown) => {
			if (options.saveFails !== undefined) throw options.saveFails;
			if (store.get(next.id)?.version !== expectedVersion) throw new Error('fixed_asset_changed');
			const saved = { ...next, version: expectedVersion + 1 };
			store.set(next.id, saved);
			return saved;
		}),
	};
	let made = 0;
	let posted = 0;
	const ledger = {
		chart: async () => options.chart ?? CHART,
		addLedger: vi.fn(async (_write: unknown, _by: string | null) => ({ id: `led_new_${++made}` })),
		post: vi.fn(async (_request: unknown, _context: unknown, _by: string | null) => ({ id: `jv_${++posted}` })),
	};
	const service = new AssetsService(
		repo as never,
		ledger as never,
		{ findVoucherByKey: async (key: string) => options.posted?.[key] ?? null } as never,
		{ withTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' }) } as never,
	);
	return { service, repo, ledger, store };
}

describe('the fixed asset register (R1, R4)', () => {
	it('lists the register, and refuses an asset that isn’t in it', async () => {
		const { service } = build({ assets: [asset('a1')] });
		expect((await service.list()).map((a) => a.id)).toEqual(['a1']);
		expect((await service.get('a1')).tag).toBe('FA-a1');
		const missing = service.get('a9');
		await expect(missing).rejects.toBeInstanceOf(NotFoundException);
		await expect(missing).rejects.toMatchObject(refusal('fixed_asset_not_found'));
	});
});

describe('adding a fixed asset (R2)', () => {
	it('tags it, puts it in its kind’s ledger, and posts its purchase against the ledger it was paid from', async () => {
		const { service, ledger, repo } = build({ assets: [asset('a1'), asset('a2')] });
		const added = await service.create(write(), accountant, now);
		expect(ledger.addLedger).not.toHaveBeenCalled();
		expect(added).toMatchObject({
			name: 'Billing counter',
			tag: 'FA-0003',
			status: 'active',
			assetLedgerId: 'led_furniture',
			acquisitionVoucherId: 'jv_1',
			accumulatedPaise: 0,
			depreciatedThrough: null,
			createdBy: 'adm_acc',
			createdAt: at,
			version: 0,
		});
		expect(added).not.toHaveProperty('acquisition');
		expect(ledger.post).toHaveBeenCalledWith(
			{
				kind: 'journal',
				date: '2026-04-10',
				narration: 'Fixed asset FA-0003 · Billing counter',
				source: { type: 'fixedAsset', id: added.id, number: 'FA-0003' },
				idempotencyKey: `fixedAsset:${added.id}`,
				lines: [
					{ ledger: { id: 'led_furniture' }, locationId: 'loc_bar', debitPaise: 6_000_000 },
					{ ledger: { id: 'led_hdfc' }, locationId: 'loc_bar', creditPaise: 6_000_000 },
				],
			},
			{ session: 'tx' },
			'adm_acc',
		);
		expect(repo.insert).toHaveBeenCalledWith(added, { session: 'tx' });
	});

	it('makes the kind’s ledger when the chart hasn’t got it, and posts nothing for a purchase already in the books', async () => {
		const { service, ledger } = build();
		const added = await service.create(
			write({ categoryKey: 'computers', acquisition: { kind: 'books' } }),
			undefined,
		);
		expect(ledger.addLedger).toHaveBeenCalledWith(
			{ name: 'Computers', groupId: 'g_fa', active: true, expectedUpdatedAt: null },
			null,
		);
		expect(ledger.post).not.toHaveBeenCalled();
		expect(added).toMatchObject({
			tag: 'FA-0001',
			assetLedgerId: 'led_new_1',
			acquisitionVoucherId: null,
			createdBy: null,
		});
	});

	it('refuses a kind it doesn’t know, a residual value above cost, and books with no Fixed assets group', async () => {
		const refused = build().service.create(write({ categoryKey: 'jewellery' }), accountant);
		await expect(refused).rejects.toBeInstanceOf(BadRequestException);
		await expect(refused).rejects.toMatchObject(refusal('asset_category_unknown'));
		await expect(build().service.create(write({ residualINR: 60_001 }), accountant)).rejects.toMatchObject(
			refusal('asset_residual_above_cost'),
		);
		await expect(
			build({ chart: { groups: [], ledgers: [] } }).service.create(write(), accountant),
		).rejects.toMatchObject(refusal('books_not_set_up'));
	});

	it('says someone saved first when its tag was just taken, and passes on any other failure', async () => {
		const taken = build({ insertFails: new Error('fixed_asset_tag_taken') }).service.create(write(), accountant);
		await expect(taken).rejects.toBeInstanceOf(ConflictException);
		await expect(taken).rejects.toMatchObject(refusal('fixed_asset_changed'));
		const diskFull = new Error('disk full');
		await expect(build({ insertFails: diskFull }).service.create(write(), accountant)).rejects.toBe(diskFull);
		const odd = { code: 'not an error' };
		await expect(build({ insertFails: odd }).service.create(write(), accountant)).rejects.toBe(odd);
	});
});

describe('changing and disposing of an asset (R4)', () => {
	const { acquisition: _acquisition, costINR: _cost, putToUseOn: _put, ...editable } = write();
	const edit = (over: Record<string, unknown> = {}) => ({ ...editable, version: 3, ...over }) as never;

	it('changes the details over the version read, and refuses once it is disposed of', async () => {
		const { service } = build({ assets: [asset('a1'), asset('a_gone', { status: 'disposed' })] });
		expect(await service.update('a1', edit({ name: 'Counter' }), now)).toMatchObject({
			name: 'Counter',
			costINR: 120_000,
			updatedAt: at,
			version: 4,
		});
		const stale = service.update('a1', edit());
		await expect(stale).rejects.toBeInstanceOf(ConflictException);
		await expect(stale).rejects.toMatchObject(refusal('fixed_asset_changed'));
		await expect(service.update('a_gone', edit())).rejects.toMatchObject(refusal('fixed_asset_disposed'));
	});

	it('checks the kind and keeps the residual value within its cost', async () => {
		const { service } = build({ assets: [asset('a1')] });
		await expect(service.update('a1', edit({ categoryKey: 'jewellery' }))).rejects.toMatchObject(
			refusal('asset_category_unknown'),
		);
		await expect(service.update('a1', edit({ residualINR: 120_001 }))).rejects.toMatchObject(
			refusal('asset_residual_above_cost'),
		);
	});

	it('passes on any other failure to save', async () => {
		const diskFull = new Error('disk full');
		await expect(build({ assets: [asset('a1')], saveFails: diskFull }).service.update('a1', edit())).rejects.toBe(
			diskFull,
		);
		const odd = { code: 'not an error' };
		await expect(build({ assets: [asset('a1')], saveFails: odd }).service.update('a1', edit())).rejects.toBe(odd);
	});

	it('disposes of it once, not before it was put to use, keeping the day and what it fetched', async () => {
		const { service } = build({ assets: [asset('a1')] });
		await expect(service.dispose('a1', { on: '2026-04-09', proceedsINR: 0, version: 3 })).rejects.toMatchObject(
			refusal('fixed_asset_disposed_before_use'),
		);
		expect(await service.dispose('a1', { on: '2026-11-20', proceedsINR: 15_000, version: 3 }, now)).toMatchObject({
			status: 'disposed',
			disposedOn: '2026-11-20',
			disposalINR: 15_000,
			updatedAt: at,
			version: 4,
		});
		await expect(service.dispose('a1', { on: '2026-11-21', proceedsINR: 0, version: 4 })).rejects.toMatchObject(
			refusal('fixed_asset_disposed'),
		);
	});
});

describe('a month’s depreciation (R3)', () => {
	/** ₹1,000 a month each (straight line), two at the warehouse and one at the shop. */
	const ASSETS = [
		asset('a1'),
		// Put to use in November: its first month.
		asset('a2', {
			categoryKey: 'computers',
			costINR: 36_000,
			lifeMonths: 36,
			putToUseOn: '2026-11-05',
			accumulatedPaise: 0,
			depreciatedThrough: null,
		}),
		asset('a3', { locationId: 'loc_shop', costINR: 60_000, lifeMonths: 60, accumulatedPaise: 700_000 }),
		// Already depreciated for November, and one with nothing left to take.
		asset('a4', { depreciatedThrough: '2026-11' }),
		asset('a5', { accumulatedPaise: 12_000_000 }),
	];

	it('previews each asset’s depreciation and its book value after, or the journal the month was posted in', async () => {
		const run = await build({ assets: ASSETS }).service.preview('2026-11');
		expect(run).toMatchObject({ month: '2026-11', totalPaise: 300_000, voucherId: null });
		expect(run.rows.map((r) => [r.assetId, r.thisMonthPaise, r.bookValueAfterPaise])).toEqual([
			['a1', 100_000, 11_200_000],
			['a2', 100_000, 3_500_000],
			['a3', 100_000, 5_200_000],
		]);
		expect(run.rows[0]).toMatchObject({
			tag: 'FA-a1',
			name: 'Asset a1',
			method: 'slm',
			lifeMonths: 120,
			costPaise: 12_000_000,
		});
		const posted = await build({
			assets: ASSETS,
			posted: { 'depreciation:2026-11': { id: 'jv_dep' } },
		}).service.preview('2026-11');
		expect(posted).toEqual({ month: '2026-11', rows: [], totalPaise: 0, voucherId: 'jv_dep' });
	});

	it('posts the month once as one journal per location, making Accumulated depreciation, and keeps what each took', async () => {
		const { service, ledger, repo } = build({ assets: ASSETS });
		const run = await service.post('2026-11', accountant, now);
		expect(ledger.addLedger).toHaveBeenCalledWith(
			{ name: ACCUMULATED_LEDGER_NAME, groupId: 'g_fa', active: true, expectedUpdatedAt: null },
			'adm_acc',
		);
		expect(ledger.post).toHaveBeenCalledWith(
			{
				kind: 'journal',
				date: '2026-11-30',
				narration: 'Depreciation for 2026-11',
				source: { type: 'depreciation', id: '2026-11', number: null },
				idempotencyKey: 'depreciation:2026-11',
				lines: [
					{ ledger: { id: 'led_dep' }, locationId: 'loc_bar', debitPaise: 200_000 },
					{ ledger: { id: 'led_new_1' }, locationId: 'loc_bar', creditPaise: 200_000 },
					{ ledger: { id: 'led_dep' }, locationId: 'loc_shop', debitPaise: 100_000 },
					{ ledger: { id: 'led_new_1' }, locationId: 'loc_shop', creditPaise: 100_000 },
				],
			},
			{ session: 'tx' },
			'adm_acc',
		);
		expect(
			repo.save.mock.calls.map(([saved, version, context]) => [
				saved.id,
				saved.accumulatedPaise,
				saved.depreciatedThrough,
				saved.updatedAt,
				version,
				context,
			]),
		).toEqual([
			['a1', 800_000, '2026-11', at, 3, { session: 'tx' }],
			['a2', 100_000, '2026-11', at, 3, { session: 'tx' }],
			['a3', 800_000, '2026-11', at, 3, { session: 'tx' }],
		]);
		expect(run).toMatchObject({ month: '2026-11', totalPaise: 300_000, voucherId: 'jv_1' });
		expect(run.rows).toHaveLength(3);
	});

	it('uses Accumulated depreciation when the chart has it, posting by nobody when no one is signed in', async () => {
		const chart = {
			...CHART,
			ledgers: [...CHART.ledgers, { id: 'led_acc', groupId: 'g_fa', name: ACCUMULATED_LEDGER_NAME, roles: [] }],
		};
		const { service, ledger } = build({ assets: [asset('a1')], chart });
		await service.post('2026-11', undefined);
		expect(ledger.addLedger).not.toHaveBeenCalled();
		expect(ledger.post.mock.calls[0]?.[0]).toMatchObject({
			lines: [expect.anything(), { ledger: { id: 'led_acc' }, locationId: 'loc_bar', creditPaise: 100_000 }],
		});
		expect(ledger.post.mock.calls[0]?.[2]).toBeNull();
	});

	it('refuses a month posted already, a month with nothing to take, a month before an earlier one, and books without depreciation', async () => {
		await expect(
			build({ assets: ASSETS, posted: { 'depreciation:2026-11': { id: 'jv_dep' } } }).service.post(
				'2026-11',
				accountant,
			),
		).rejects.toMatchObject(refusal('depreciation_posted'));
		await expect(build({ assets: ASSETS }).service.post('2026-03', accountant)).rejects.toMatchObject(
			refusal('depreciation_nothing'),
		);
		// September not posted yet, or put to use in August and never depreciated.
		for (const behind of [
			asset('a6', { depreciatedThrough: '2026-09' }),
			asset('a7', { putToUseOn: '2026-08-01', depreciatedThrough: null, accumulatedPaise: 0 }),
		])
			await expect(
				build({ assets: [asset('a1'), behind] }).service.post('2026-11', accountant),
			).rejects.toMatchObject(refusal('depreciation_earlier_month_first'));
		await expect(
			build({ assets: ASSETS, chart: { ...CHART, ledgers: CHART.ledgers.slice(0, 1) } }).service.post(
				'2026-11',
				accountant,
			),
		).rejects.toMatchObject(refusal('books_not_set_up'));
	});
});

describe('the asset routes and module', () => {
	it('hand each call to the service with its permission and code, and are wired into the app', () => {
		const assets = new Proxy(
			{},
			{
				get:
					(_t, name: string) =>
					(...args: unknown[]) => [name, ...args],
			},
		);
		const c = new AssetsController(assets as never);
		const body = write();
		const disposal = { on: '2026-11-20', proceedsINR: 0, version: 3 };
		const change = { name: 'x', version: 3 } as never;
		expect([
			c.list(),
			c.preview('2026-11'),
			c.post('2026-11', accountant),
			c.post('2026-11'),
			c.get('a1'),
			c.create(body, accountant),
			c.create(body),
			c.update('a1', change),
			c.dispose('a1', disposal),
		]).toEqual([
			['list'],
			['preview', '2026-11'],
			['post', '2026-11', accountant],
			['post', '2026-11', undefined],
			['get', 'a1'],
			['create', body, accountant],
			['create', body, undefined],
			['update', 'a1', change],
			['dispose', 'a1', disposal],
		]);
		const perm = (m: keyof AssetsController) => new Reflector().get(PERMISSIONS_KEY, AssetsController.prototype[m]);
		expect((['list', 'preview', 'post', 'get', 'create', 'update', 'dispose'] as const).map(perm)).toEqual([
			['accounts.index'],
			['accounts.index'],
			['accounts.post'],
			['accounts.index'],
			['accounts.post'],
			['accounts.edit'],
			['accounts.post'],
		]);
		const code = (m: keyof AssetsController) => Reflect.getMetadata('__httpCode__', AssetsController.prototype[m]);
		expect([code('post'), code('dispose')]).toEqual([200, 200]);
		expect(Reflect.getMetadata('imports', AssetsModule)).toEqual([LedgerModule]);
		expect(AppModule.forRoot({} as never).imports).toContain(AssetsModule);
	});

	it('offers the kinds of asset with their presets and the residual percent, before an asset by id', () => {
		const c = new AssetsController({} as never);
		expect(c.categories()).toEqual({ categories: ASSET_CATEGORIES, residualPercent: RESIDUAL_PERCENT });
		expect(new Reflector().get(PERMISSIONS_KEY, AssetsController.prototype.categories)).toEqual(['accounts.index']);
		expect(Reflect.getMetadata('path', AssetsController.prototype.categories)).toBe('categories');
		// Routes are matched in the order they are declared: "categories" must come before ":id".
		const order = Object.getOwnPropertyNames(AssetsController.prototype);
		expect(order.indexOf('categories')).toBeLessThan(order.indexOf('get'));
	});
});
