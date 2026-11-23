import { ConflictException } from '@nestjs/common';
import { StaleVersionError, StockMovementRefusedError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PurchaseEntriesService, entryView } from '../src/purchasing/purchase-entries.service';

/**
 * Purchase entries from draft to posted, voided and paid (p01–p13), with their postings in the books (Postings and
 * Convert brief P1). Every store is in memory; the books are a recorder.
 */

const at = '2026-11-20T05:00:00.000Z';
const TODAY = '2026-11-24';

type Row = Record<string, unknown>;

const lineOf = (o: Row = {}): Row => ({
	lineId: 'l1',
	productId: 'p1',
	variantId: 'v1',
	sku: 'SAR-1',
	title: 'Saree',
	optionsLabel: '',
	soldBy: 'piece',
	imageUrl: null,
	supplierItemCode: null,
	hsnOnBill: null,
	productHsn: null,
	gstRatePct: 5,
	quantity: 10,
	unitPriceINR: 100,
	freeOnBill: false,
	purchaseOrderLineId: null,
	notOrdered: false,
	accepted: null,
	damaged: 0,
	missing: 0,
	damageReason: null,
	damageNote: null,
	damagePhotoAssetIds: [],
	taxableINR: 1_000,
	taxINR: 50,
	lineTotalINR: 1_050,
	freightShareINR: 0,
	unitCostINR: 100,
	sellingPriceINR: 200,
	marginPct: 50,
	lastCostINR: null,
	costLayerId: null,
	...o,
});

const entryOf = (o: Row = {}): Row => ({
	id: 'pe_1',
	number: null,
	status: 'draft',
	paymentStatus: 'unpaid',
	supplierId: 'sup_1',
	supplierName: 'Bose Textiles',
	supplierGstin: null,
	supplierStateCode: '19',
	supplierKind: 'registered',
	taxType: 'intra_state',
	purchaseOrderId: null,
	purchaseOrderNumber: null,
	billNumber: 'B-77',
	billDate: '2026-11-20',
	goodsReceivedOn: '2026-11-20',
	pricesIncludeGst: false,
	freightINR: 0,
	freightGstRatePct: 0,
	roundOffINR: 0,
	billAttachment: null,
	lines: [lineOf()],
	totals: {
		linesINR: 1_000,
		freightINR: 0,
		taxableINR: 1_000,
		cgstINR: 25,
		sgstINR: 25,
		igstINR: 0,
		roundOffINR: 0,
		totalINR: 1_050,
		printedTotalINR: 1_050,
		matchesPrinted: true,
		differenceINR: 0,
		pieces: 10,
		costIntoStockINR: 1_000,
	},
	warnings: [],
	acceptedWarnings: [],
	itcClaimable: true,
	dueOn: '2026-12-20',
	paidINR: 0,
	creditedINR: 0,
	createdBy: 'adm_a',
	checkedBy: null,
	checkedAt: null,
	postedBy: null,
	postedAt: null,
	voidedBy: null,
	voidedAt: null,
	voidReason: null,
	returnDraftIds: [],
	createdAt: at,
	updatedAt: at,
	updatedBy: null,
	version: 1,
	...o,
});

interface Options {
	entries?: Row[];
	duplicate?: Row | null;
	saveFails?: unknown[];
	claim?: 'new' | 'seen';
	built?: (write: unknown, existing: Row | null) => Row;
	stepProblem?: string;
	settings?: Row;
	layers?: Row[];
	returns?: Row[];
	payments?: Row[];
	orders?: Row[];
	products?: Record<string, Row | null>;
	variants?: Record<string, Row[]>;
	/** Products had nothing free before posting (the first read of each). */
	emptyBefore?: boolean;
	moveFails?: unknown;
	payables?: Row[];
	monthly?: Row[];
	counts?: Record<string, number>;
	outbox?: 'none' | 'fails';
}

const owner = { userId: 'adm_b', permissions: ['stock.cost'] } as never;
const viewer = { userId: 'adm_c', permissions: [] } as never;

function setupEntries(o: Options = {}) {
	const store = new Map((o.entries ?? [entryOf()]).map((e) => [e['id'] as string, e]));
	const saveFails = [...(o.saveFails ?? [])];
	const audit: { action: string; text: string }[] = [];
	const saved: Row[] = [];
	const orderSaves: Row[] = [];
	const returnSaves: Row[] = [];
	const removedReturns: string[] = [];
	const moves: Row[] = [];
	const layers: Row[] = [];
	const remembered: unknown[] = [];
	const paymentSaves: Row[] = [];
	const productSaves: Row[] = [];
	const outbox: unknown[] = [];
	const readBefore = new Set<string>();
	const settings = {
		stepRules: { checkByDifferentPerson: false, postByDifferentPerson: false, paymentByDifferentPerson: false },
		numberFormats: { purchaseEntry: 'PE/{fy}/{seq6}' },
		booksClosedUpTo: null,
		...o.settings,
	};
	const books = {
		purchaseEntryPosted: vi.fn(async () => null),
		purchaseEntryVoided: vi.fn(async () => null),
		supplierPaid: vi.fn(async () => null),
		supplierPaymentReversed: vi.fn(async () => null),
	};
	const payments = o.payments ?? [];
	const service = new PurchaseEntriesService(
		{
			findById: async (id: string) => store.get(id) ?? null,
			findByBill: async () => o.duplicate ?? null,
			save: async (entry: Row, expected: number | null) => {
				const failure = saveFails.shift();
				if (failure) throw failure;
				store.set(entry['id'] as string, entry);
				saved.push(entry);
				return (expected ?? 0) + 1;
			},
			remove: async (id: string) => void store.delete(id),
			claimRequestKey: async () => o.claim ?? 'new',
			list: async (query: { filter?: string }) => ({
				items: [...store.values()],
				total: store.size,
				counts: query.filter === 'all' ? (o.counts ?? { draft: 2, checked: 1 }) : {},
			}),
			openPayables: async () => o.payables ?? [],
			postedBetween: async () => o.monthly ?? [],
		} as never,
		{
			findById: async (id: string) => (o.orders ?? []).find((row) => row['id'] === id) ?? null,
			save: async (order: Row) => void orderSaves.push(order),
		} as never,
		{
			forEntry: async () => o.returns ?? [],
			save: async (doc: Row) => void returnSaves.push(doc),
			remove: async (id: string) => void removedReturns.push(id),
		} as never,
		{
			forEntry: async () => payments,
			findById: async (id: string) => payments.find((row) => row['id'] === id) ?? null,
			save: async (payment: Row) => void paymentSaves.push(payment),
		} as never,
		{ remember: async (...args: unknown[]) => void remembered.push(args) } as never,
		{
			variantsOfProduct: async (productId: string) => {
				if (o.emptyBefore && !readBefore.has(productId)) {
					readBefore.add(productId);
					return [];
				}
				return (o.variants ?? {})[productId] ?? [];
			},
			layersForEntry: async () => o.layers ?? [],
		} as never,
		{
			move: async (move: Row) => {
				if (o.moveFails) throw o.moveFails;
				moves.push(move);
			},
			consumeLayer: async (...args: unknown[]) => void moves.push({ consumed: args }),
		} as never,
		{ createLayer: async (layer: Row) => void layers.push(layer) } as never,
		{ next: async () => 7, peek: async () => 8 } as never,
		{
			findById: async (id: string) =>
				o.products && id in o.products ? o.products[id] : { id, lifetimeUnitsReceived: 0, backInStockAt: null },
			save: async (product: Row) => void productSaves.push(product),
		} as never,
		{
			build: async (write: unknown, existing: Row | null) => {
				const entry = o.built ? o.built(write, existing) : { ...(existing ?? entryOf()) };
				return {
					entry,
					math: { lines: [{ lineId: 'l1', unitCostPerStockUnitINR: 100 }] },
					settings,
					order: (entry['__order'] as Row | undefined) ?? null,
				};
			},
		} as never,
		{
			record: async (input: { action: string; text: string }) => void audit.push(input),
			nameOf: async (id: string | null) => (id ? 'Asha' : 'Someone'),
			settings: async () => settings,
			stepRoleProblem: async (_actor: string | null, step: string) =>
				o.stepProblem === step ? { code: 'step_role', detail: 'Not your step' } : null,
			staleConflict: async () => new ConflictException('stale'),
			guardStale: async <T>(work: () => Promise<T>) => {
				try {
					return await work();
				} catch (error) {
					if (error instanceof StaleVersionError) throw new ConflictException('stale');
					throw error;
				}
			},
			inTransaction: <T>(work: (context: object) => Promise<T>) => work({}),
			today: () => TODAY,
			activity: async (type: string, ids: string[]) => [{ type, ids }],
		} as never,
		books as never,
		o.outbox === 'none'
			? null
			: ({
					request: async (ids: unknown) => {
						if (o.outbox === 'fails') throw new Error('queue down');
						outbox.push(ids);
					},
				} as never),
	);
	return {
		service,
		store,
		audit,
		saved,
		orderSaves,
		returnSaves,
		removedReturns,
		moves,
		layers,
		remembered,
		paymentSaves,
		productSaves,
		outbox,
		books,
	};
}

const issues = (error: unknown) =>
	(error as { response?: { issues?: { code: string; message: string }[] } }).response?.issues ?? [];
async function refusal(work: Promise<unknown>): Promise<string[]> {
	try {
		await work;
	} catch (error) {
		const coded = issues(error).map((issue) => issue.code);
		return coded.length ? coded : [(error as Error).message];
	}
	throw new Error('expected a refusal');
}

describe('a purchase entry’s view', () => {
	it('keeps cost and margins for those who see cost, and hides them otherwise', () => {
		const entry = entryOf({
			warnings: [
				{ code: 'margin_floor', detail: 'Margin 4%', values: { pct: 4 }, lineId: 'l1' },
				{ code: 'price_jump', detail: 'Up 30%', values: {}, lineId: 'l1' },
			],
			acceptedWarnings: [{ code: 'margin_floor', detail: 'Margin 4%', values: { pct: 4 }, lineId: 'l1' }],
		}) as never;
		expect(entryView(entry, true)).toBe(entry);
		const hidden = entryView(entry, false) as unknown as Row & {
			lines: Row[];
			totals: Row;
			warnings: Row[];
			acceptedWarnings: Row[];
		};
		expect(hidden.lines[0]).toMatchObject({ unitCostINR: null, marginPct: null });
		expect(hidden.totals['costIntoStockINR']).toBeNull();
		expect(hidden.warnings.map((w) => w['detail'])).toEqual(['Margin is under your floor.', 'Up 30%']);
		expect(hidden.acceptedWarnings[0]).toMatchObject({ values: {} });
	});
});

describe('drafts', () => {
	it('opens an entry, and says when there is none', async () => {
		const { service } = setupEntries();
		expect(await service.get('pe_1', viewer)).toMatchObject({ id: 'pe_1' });
		expect(await refusal(service.get('pe_x', owner))).toEqual(['Purchase entry not found']);
	});

	it('makes a draft, empty or with lines, and refuses a step not theirs or a bill entered before', async () => {
		const { service, audit } = setupEntries({ built: () => entryOf({ lines: [] }) });
		expect(await service.create({} as never, owner)).toMatchObject({ status: 'draft', version: 1 });
		const withLines = setupEntries();
		await withLines.service.create({} as never, undefined);
		expect(audit[0]?.text).toBe('Asha made a draft for Bose Textiles, bill B-77.');
		expect(withLines.audit[0]?.text).toContain('Someone made a draft for Bose Textiles, bill B-77: 1 lines, ');
		expect(await refusal(setupEntries({ stepProblem: 'draft' }).service.create({} as never, owner))).toEqual([
			'step_role',
		]);
		const twice = setupEntries({ duplicate: { id: 'pe_0', billNumber: 'B77', number: 'PE/26-27/000001' } });
		expect(await refusal(twice.service.create({} as never, owner))).toEqual(['duplicate_bill']);
	});

	it('turns a save the bill index refused into the duplicate refusal, and passes other failures on', async () => {
		const raced = setupEntries({ saveFails: [{ code: 11000 }] });
		let calls = 0;
		Object.assign(raced.service, {});
		const findByBill = vi.fn(async () => (calls++ ? { id: 'pe_0', billNumber: 'B77', number: null } : null));
		Object.assign((raced.service as unknown as { entries: Row }).entries, { findByBill });
		const error = await raced.service.create({} as never, owner).catch((e: unknown) => e);
		expect(issues(error)[0]?.message).toBe('Bose Textiles bill B77 is already entered as a draft.');
		const lost = setupEntries({ saveFails: [{ code: 11000 }] });
		expect(await lost.service.create({} as never, owner).catch((e: unknown) => e)).toEqual({ code: 11000 });
		for (const failure of [null, 'text', new Error('db down')]) {
			const other = setupEntries({ saveFails: [failure ?? { code: 1 }] });
			await expect(other.service.create({} as never, owner)).rejects.toBeTruthy();
		}
		const stale = setupEntries({
			saveFails: [
				new StaleVersionError('purchase_entry', 'pe_1', { version: 2, updatedAt: at, updatedBy: null }),
			],
		});
		await expect(stale.service.create({} as never, owner)).rejects.toBeInstanceOf(ConflictException);
	});

	it('changes a draft: locked once posted, stale versions refused, the goods check undone when lines change', async () => {
		const posted = setupEntries({ entries: [entryOf({ status: 'posted' })] });
		expect(await refusal(posted.service.update('pe_1', {} as never, owner))).toEqual(['wrong_status']);
		const stale = setupEntries({ entries: [entryOf({ version: 3, updatedBy: 'adm_z' })] });
		await expect(stale.service.update('pe_1', { version: 2 } as never, owner)).rejects.toBeInstanceOf(
			ConflictException,
		);
		const staleNobody = setupEntries({ entries: [entryOf({ version: 3 })] });
		await expect(staleNobody.service.update('pe_1', { version: 2 } as never, owner)).rejects.toBeInstanceOf(
			ConflictException,
		);
		expect(
			await refusal(
				setupEntries({ stepProblem: 'draft' }).service.update('pe_1', { version: 1 } as never, owner),
			),
		).toEqual(['step_role']);

		const checked = entryOf({ status: 'checked', lines: [lineOf({ accepted: 10 })] });
		const keep = setupEntries({ entries: [checked], built: (_w, existing) => ({ ...existing }) });
		expect(await keep.service.update('pe_1', {} as never, owner)).toMatchObject({ status: 'checked' });
		expect(keep.audit[0]?.text).toBe('Asha changed the bill details.');

		const changed = setupEntries({
			entries: [checked],
			built: () => entryOf({ status: 'checked', freightINR: 120, lines: [lineOf({ quantity: 12 })] }),
		});
		expect(await changed.service.update('pe_1', {} as never, owner)).toMatchObject({
			status: 'draft',
			checkedBy: null,
		});
		expect(changed.audit[0]?.text).toContain('. Freight ₹120 shared by value. The goods check must be done again.');

		const emptied = setupEntries({ entries: [checked], built: () => entryOf({ status: 'checked', lines: [] }) });
		expect(await emptied.service.update('pe_1', {} as never, owner)).toMatchObject({ status: 'draft' });
		const draft = setupEntries({ built: () => entryOf({ lines: [lineOf({ unitPriceINR: 90 })] }) });
		await draft.service.update('pe_1', {} as never, owner);
		expect(draft.audit[0]?.text).toMatch(/changed the lines: 1 lines, .*\.$/);
		expect(draft.audit[0]?.text).not.toContain('Freight');
	});

	it('deletes only a draft or checked entry', async () => {
		expect(
			await refusal(setupEntries({ entries: [entryOf({ status: 'posted' })] }).service.remove('pe_1', null)),
		).toEqual(['wrong_status']);
		const { service, store, audit } = setupEntries({ entries: [entryOf({ status: 'checked' })] });
		await service.remove('pe_1', 'adm_a');
		expect(store.has('pe_1')).toBe(false);
		expect(audit[0]?.action).toBe('purchase.entry.delete');
	});
});

describe('the goods check', () => {
	const body = (lines: Row[], version?: number) => ({ lines, version }) as never;

	it('refuses an entry posted, stale, empty, without the printed total or not matching it', async () => {
		const cases: [Row, string][] = [
			[entryOf({ status: 'posted' }), 'wrong_status'],
			[entryOf({ lines: [] }), 'no_lines'],
			[entryOf({ totals: { ...(entryOf()['totals'] as Row), printedTotalINR: null } }), 'printed_total_missing'],
			[
				entryOf({
					totals: { ...(entryOf()['totals'] as Row), matchesPrinted: false, differenceINR: -12 },
				}),
				'total_mismatch',
			],
		];
		for (const [entry, code] of cases)
			expect(
				await refusal(setupEntries({ entries: [entry] }).service.checkGoods('pe_1', body([]), owner)),
			).toEqual([code]);
		await expect(setupEntries().service.checkGoods('pe_1', body([], 9), owner)).rejects.toBeInstanceOf(
			ConflictException,
		);
		expect(
			await refusal(setupEntries({ stepProblem: 'check' }).service.checkGoods('pe_1', body([]), owner)),
		).toEqual(['step_role']);
	});

	it('wants someone other than the draft’s maker when the rule says so, and every line counted right', async () => {
		const strict = setupEntries({ settings: { stepRules: { checkByDifferentPerson: true } } });
		expect(
			await refusal(strict.service.checkGoods('pe_1', body([]), { userId: 'adm_a', permissions: [] } as never)),
		).toEqual(['same_person']);
		const wrong = await refusal(
			setupEntries().service.checkGoods(
				'pe_1',
				body([{ lineId: 'l1', accepted: 3, damaged: 0, missing: 0 }]),
				owner,
			),
		);
		expect(wrong.length).toBeGreaterThan(0);
	});

	it('saves good, damaged and missing per line and tells the story', async () => {
		const entry = entryOf({
			lines: [
				lineOf(),
				lineOf({ lineId: 'l2', sku: 'SAR-2' }),
				lineOf({ lineId: 'l3', sku: 'SAR-3' }),
				lineOf({ lineId: 'l4', sku: 'SAR-4' }),
			],
		});
		const { service, audit } = setupEntries({ entries: [entry] });
		const checked = (await service.checkGoods(
			'pe_1',
			body([
				{
					lineId: 'l1',
					accepted: 7,
					damaged: 2,
					missing: 1,
					damageReason: 'wrong_item',
					damageNote: 'torn',
					damagePhotoAssetIds: ['ast_1'],
				},
				{
					lineId: 'l2',
					accepted: 8,
					damaged: 2,
					missing: 0,
					damageReason: 'other',
					damageNote: null,
					damagePhotoAssetIds: ['ast_2', 'ast_3'],
				},
				{
					lineId: 'l4',
					accepted: 9,
					damaged: 1,
					missing: 0,
					damageReason: 'other',
					damageNote: null,
					damagePhotoAssetIds: [],
				},
				{
					lineId: 'l3',
					accepted: 9,
					damaged: 0,
					missing: 1,
					damageReason: 'other',
					damageNote: 'x',
					damagePhotoAssetIds: ['ast_4'],
				},
			]),
			owner,
		)) as unknown as { status: string; lines: Row[] };
		expect(checked.status).toBe('checked');
		expect(checked.lines[2]).toMatchObject({ damageReason: null, damageNote: null, damagePhotoAssetIds: [] });
		expect(audit[0]?.text).toContain(
			'good, 2 damaged (SAR-1, "torn", 1 photo), 1 missing (SAR-1), 2 damaged (SAR-2, 2 photos), 1 missing (SAR-3), 1 damaged (SAR-4).',
		);
		const clean = setupEntries();
		await clean.service.checkGoods('pe_1', body([{ lineId: 'l1', accepted: 10, damaged: 0, missing: 0 }]), owner);
		expect(clean.audit[0]?.text).toMatch(/good, none damaged, none missing\.$/);
	});
});

describe('posting', () => {
	const checked = (o: Row = {}) =>
		entryOf({
			status: 'checked',
			checkedBy: 'adm_a',
			lines: [lineOf({ accepted: 10 })],
			...o,
		});
	const post = (keys: string[] = [], version?: number) =>
		({ requestKey: 'post-key-0001', acceptWarningCodes: keys, version }) as never;

	it('shows what posting will change, with cost only for those who see it', async () => {
		const entry = checked({
			lines: [
				lineOf({ accepted: 8, damaged: 1, missing: 1 }),
				lineOf({ lineId: 'l2', variantId: 'v2', accepted: null }),
			],
			warnings: [{ code: 'margin_floor', detail: 'Margin 4%', values: {}, lineId: 'l1' }],
		});
		const { service } = setupEntries({ entries: [entry], built: () => entry });
		const seen = (await service.postPreview('pe_1', owner)) as Row;
		expect(seen).toMatchObject({
			numberPreview: 'PE/26-27/000008',
			skus: 1,
			hasDamaged: true,
			hasMissing: true,
			costIntoStockINR: 800,
			paymentTermsDays: 30,
		});
		const hidden = (await service.postPreview('pe_1', viewer)) as Row & { warnings: Row[] };
		expect(hidden['costIntoStockINR']).toBeNull();
		expect(hidden.warnings[0]?.['detail']).toBe('Margin is under your floor.');
		const early = setupEntries({ entries: [checked({ dueOn: '2026-11-01' })] });
		expect(((await early.service.postPreview('pe_1', owner)) as Row)['paymentTermsDays']).toBe(0);
		const unknownCost = setupEntries({
			entries: [checked({ lines: [lineOf({ lineId: 'lx', accepted: 2 })] })],
		});
		expect(((await unknownCost.service.postPreview('pe_1', owner)) as Row)['costIntoStockINR']).toBe(0);
	});

	it('returns the posted entry when the same press comes again, and refuses the wrong state', async () => {
		const again = setupEntries({ entries: [entryOf({ status: 'posted', postRequestKey: 'post-key-0001' })] });
		expect(await again.service.post('pe_1', post(), owner)).toMatchObject({ status: 'posted' });
		const otherKey = setupEntries({ entries: [entryOf({ status: 'posted', postRequestKey: 'other-key' })] });
		expect(issues(await otherKey.service.post('pe_1', post(), owner).catch((e: unknown) => e))[0]?.message).toBe(
			'This entry is already posted.',
		);
		expect(
			issues(
				await setupEntries()
					.service.post('pe_1', post(), owner)
					.catch((e: unknown) => e),
			)[0]?.message,
		).toBe('Check the goods before posting.');
		await expect(
			setupEntries({ entries: [checked()] }).service.post('pe_1', post([], 5), owner),
		).rejects.toBeInstanceOf(ConflictException);
		expect(
			await refusal(
				setupEntries({ entries: [checked()], stepProblem: 'post' }).service.post('pe_1', post(), owner),
			),
		).toEqual(['step_role']);
		const strict = setupEntries({ entries: [checked()], settings: { stepRules: { postByDifferentPerson: true } } });
		expect(
			await refusal(strict.service.post('pe_1', post(), { userId: 'adm_a', permissions: [] } as never)),
		).toEqual(['same_person']);
	});

	it('wants every current warning seen, and every line counted', async () => {
		const warned = checked({
			warnings: [{ code: 'margin_floor', detail: 'Margin 4%', values: {}, lineId: 'l1' }],
		});
		const seeing = await setupEntries({ entries: [warned] })
			.service.post('pe_1', post(), owner)
			.catch((e: unknown) => e);
		expect(issues(seeing)[0]).toMatchObject({ code: 'warnings_changed', message: 'Margin 4%' });
		const blind = await setupEntries({ entries: [warned] })
			.service.post('pe_1', post(), viewer)
			.catch((e: unknown) => e);
		expect(issues(blind)[0]?.message).toBe('Margin is under your floor.');
		const uncounted = checked({ lines: [lineOf({ accepted: 10 }), lineOf({ lineId: 'l2', accepted: null })] });
		expect(await refusal(setupEntries({ entries: [uncounted] }).service.post('pe_1', post(), owner))).toEqual([
			'goods_check_missing_line',
		]);
	});

	it('posts: stock, cost layers, the purchase order, return drafts, the books and the story', async () => {
		const order = {
			id: 'po_1',
			status: 'sent',
			version: 4,
			linkedEntryIds: ['pe_0'],
			lines: [
				{ lineId: 'pol_1', quantity: 30, receivedQuantity: 0 },
				{ lineId: 'pol_2', quantity: 5, receivedQuantity: 5, receivedOn: [{ entryId: 'pe_0', quantity: 5 }] },
				{ lineId: 'pol_3', quantity: 5, receivedQuantity: 0 },
			],
		};
		const entry = checked({
			taxType: 'inter_state',
			goodsReceivedOn: TODAY,
			totals: { ...(entryOf()['totals'] as Row), igstINR: 50, costIntoStockINR: null },
			acceptedWarnings: [],
			lines: [
				lineOf({
					accepted: 7,
					damaged: 2,
					missing: 1,
					damageReason: 'damaged_on_arrival',
					damageNote: 'wet',
					damagePhotoAssetIds: ['ast_1'],
					supplierItemCode: 'BS-11',
					purchaseOrderLineId: 'pol_1',
				}),
				lineOf({
					lineId: 'l2',
					productId: 'p2',
					variantId: 'v2',
					accepted: 0,
					damaged: 5,
					missing: 0,
					damageReason: null,
					purchaseOrderLineId: 'pol_1',
				}),
				lineOf({ lineId: 'l3', variantId: 'v3', accepted: 4, damaged: 1, damageReason: 'wrong_item' }),
				lineOf({ lineId: 'l4', variantId: 'v4', accepted: 5, purchaseOrderLineId: 'pol_2' }),
			],
			warnings: [
				{ code: 'price_jump', detail: 'Up 30%', values: {}, lineId: 'l3' },
				{ code: 'price_jump', detail: 'Up 9%', values: {}, lineId: 'gone' },
				{ code: 'no_hsn', detail: 'No HSN', values: {}, lineId: null },
			],
		});
		const { service, books, audit, layers, moves, orderSaves, returnSaves, remembered, productSaves, outbox } =
			setupEntries({
				entries: [entry],
				built: () => ({ ...entry, __order: order }),
				variants: { p1: [{ onHand: 0, held: 0 }], p2: [{ onHand: 3, held: 1 }] },
				products: {
					p1: { id: 'p1', lifetimeUnitsReceived: 4, backInStockAt: null },
					p2: { id: 'p2', lifetimeUnitsReceived: 0, backInStockAt: null },
				},
			});
		const keys = ['price_jump:l3', 'price_jump:gone', 'no_hsn:'];
		const posted = (await service.post(
			'pe_1',
			{ requestKey: 'post-key-0001', acceptWarningCodes: keys } as never,
			owner,
		)) as unknown as Row & { lines: Row[] };
		expect(posted).toMatchObject({ status: 'posted', number: 'PE/26-27/000007', version: 2 });
		expect(layers).toHaveLength(3);
		expect(layers[0]).toMatchObject({ unitCostINR: 100, receivedAt: expect.stringContaining('2026') });
		expect(moves).toHaveLength(3);
		expect(remembered).toEqual([['sup_1', 'BS-11', 'v1', {}]]);
		expect(posted.lines[1]?.['costLayerId']).toBeNull();
		expect(orderSaves[0]).toMatchObject({ linkedEntryIds: ['pe_0', 'pe_1'], late: false });
		expect((orderSaves[0]?.['lines'] as Row[])[0]).toMatchObject({ receivedQuantity: 20 });
		expect(returnSaves.map((d) => [d['kind'], d['reason']])).toEqual([
			['return_goods', 'damaged_on_arrival'],
			['return_goods', 'wrong_item'],
			['return_goods', 'other'],
			['short_supply', 'short_supplied'],
		]);
		expect(returnSaves[0]).toMatchObject({ noteToSupplier: 'wet', photoAssetIds: ['ast_1'] });
		expect(returnSaves[1]?.['noteToSupplier']).toBeNull();
		expect(books.purchaseEntryPosted).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'posted' }),
			{},
			'adm_b',
		);
		expect(audit[0]?.text).toContain('across 3 SKUs, cost ₹0, IGST ₹50.');
		expect(audit[0]?.text).toContain('Accepted 3 warnings: SAR-1 Up 30%;  Up 9%; No HSN');
		expect(audit[0]?.text).toContain('Made 4 return drafts for the supplier.');
		expect(productSaves[0]).toMatchObject({ lifetimeUnitsReceived: 4 + 7 + 4 + 5 });
		expect(productSaves[1]).toMatchObject({ backInStockAt: null });
		expect(outbox).toEqual([['p1', 'p2']]);
	});

	it('posts a plain bill in the State or without GST, one SKU, one warning, one draft, no order', async () => {
		const entry = checked({
			goodsReceivedOn: '2026-11-21',
			lines: [lineOf({ accepted: 9, missing: 1 })],
			warnings: [{ code: 'price_jump', detail: 'Up 30%', values: {}, lineId: 'l1' }],
		});
		const { service, audit, productSaves, layers } = setupEntries({
			entries: [entry],
			built: () => entry,
			variants: { p1: [{ onHand: 9, held: 0 }] },
			products: { p1: { id: 'p1', lifetimeUnitsReceived: 3, backInStockAt: null } },
			emptyBefore: true,
			outbox: 'none',
		});
		await service.post('pe_1', post(['price_jump:l1']), viewer);
		expect(layers[0]?.['receivedAt']).toBe('2026-11-21T06:30:00.000Z');
		expect(audit[0]?.text).toContain('across 1 SKU, cost ₹1,000, CGST ₹25, SGST ₹25.');
		expect(audit[0]?.text).toContain('Accepted 1 warning: SAR-1 Up 30%');
		expect(audit[0]?.text).toContain('Made 1 return draft for the supplier.');
		expect(productSaves[0]?.['backInStockAt']).toEqual(expect.any(String));

		const none = checked({ taxType: 'none', lines: [lineOf({ accepted: 10 })] });
		const noTax = setupEntries({
			entries: [none],
			built: () => none,
			products: { p1: null },
			outbox: 'fails',
		});
		await noTax.service.post('pe_1', post(), owner);
		expect(noTax.audit[0]?.text).toMatch(/no GST \(no input credit\)\.$/);
		expect(noTax.productSaves).toEqual([]);
	});

	it('turns a race into words: claimed already, stock moved, or the post key taken; other failures pass on', async () => {
		const entry = checked();
		expect(
			await refusal(setupEntries({ entries: [entry], claim: 'seen' }).service.post('pe_1', post(), owner)),
		).toEqual(['post_in_progress']);
		expect(
			await refusal(
				setupEntries({ entries: [entry], moveFails: new StockMovementRefusedError('v1') }).service.post(
					'pe_1',
					post(),
					owner,
				),
			),
		).toEqual(['stock_moved_meanwhile']);
		expect(
			await refusal(
				setupEntries({ entries: [entry], saveFails: [{ code: 11000 }] }).service.post('pe_1', post(), owner),
			),
		).toEqual(['post_in_progress']);
		expect(
			await refusal(
				setupEntries({ entries: [entry], moveFails: new Error('db down') }).service.post('pe_1', post(), owner),
			),
		).toEqual(['db down']);
	});
});

describe('voiding', () => {
	const posted = (o: Row = {}) =>
		entryOf({
			status: 'posted',
			number: 'PE/26-27/000007',
			lines: [lineOf({ accepted: 10, purchaseOrderLineId: 'pol_1' }), lineOf({ lineId: 'l2', variantId: 'v2' })],
			...o,
		});
	const layer = (o: Row = {}) => ({
		id: 'lay_1',
		variantId: 'v1',
		sourceLineId: 'l1',
		quantityReceived: 10,
		quantityRemaining: 10,
		...o,
	});
	const reason = { reason: 'Wrong supplier' } as never;

	it('refuses an entry not posted, in closed books, or with stock, returns or payments moved', async () => {
		expect(await refusal(setupEntries().service.void('pe_1', reason, null))).toEqual(['wrong_status']);
		expect(
			await refusal(
				setupEntries({ entries: [posted()], settings: { booksClosedUpTo: '2026-11-30' } }).service.void(
					'pe_1',
					reason,
					null,
				),
			),
		).toEqual(['books_closed']);
		const sold = await setupEntries({
			entries: [posted()],
			layers: [layer({ quantityRemaining: 4 }), layer({ id: 'lay_2', sourceLineId: null, variantId: 'v9' })],
			returns: [
				{ status: 'sent', kind: 'return_goods', origin: 'manual', lines: [{ entryLineId: 'l1', quantity: 2 }] },
				{ status: 'sent', kind: 'return_goods', origin: 'manual', lines: [{ entryLineId: 'l1', quantity: 1 }] },
				{ status: 'draft', kind: 'return_goods', origin: 'manual', lines: [] },
				{ status: 'sent', kind: 'short_supply', origin: 'manual', lines: [] },
				{ status: 'sent', kind: 'return_goods', origin: 'goods_check', lines: [] },
			],
		})
			.service.void('pe_1', reason, null)
			.catch((e: unknown) => e);
		expect(issues(sold)).toEqual([
			{ path: ['void_stock_moved', 'SAR-1'], code: 'void_stock_moved', message: 'sold 3, returned 3' },
		]);
		const odd = setupEntries({ entries: [posted()], layers: [layer({ quantityRemaining: 12 })] });
		expect(await refusal(odd.service.void('pe_1', reason, null))).toEqual(['void_stock_moved']);
		const sent = setupEntries({
			entries: [posted()],
			layers: [layer()],
			returns: [{ status: 'sent', kind: 'short_supply', origin: 'manual', lines: [] }],
		});
		expect(await refusal(sent.service.void('pe_1', reason, null))).toEqual(['void_returns']);
		const paid = setupEntries({
			entries: [posted()],
			layers: [layer()],
			payments: [
				{ id: 'pay_1', reversedAt: null },
				{ id: 'pay_0', reversedAt: at },
			],
		});
		expect(await refusal(paid.service.void('pe_1', reason, null))).toEqual(['void_payments']);
	});

	it('voids: stock out, the purchase order reopened, drafts removed, the books reversed', async () => {
		const orders = [
			{
				id: 'po_1',
				status: 'received',
				version: 2,
				linkedEntryIds: ['pe_1', 'pe_0'],
				lines: [
					{ lineId: 'pol_1', receivedQuantity: 15, receivedOn: [{ entryId: 'pe_1' }, { entryId: 'pe_0' }] },
					{ lineId: 'pol_2', receivedQuantity: 0 },
				],
			},
		];
		const entry = posted({ purchaseOrderId: 'po_1' });
		const { service, moves, orderSaves, removedReturns, books, audit, outbox } = setupEntries({
			entries: [entry],
			orders,
			layers: [
				layer(),
				layer({ id: 'lay_2', variantId: 'v2', sourceLineId: 'l2', quantityRemaining: 0, quantityReceived: 0 }),
				layer({ id: 'lay_3', variantId: 'v3', sourceLineId: null, quantityRemaining: 2, quantityReceived: 2 }),
			],
			returns: [{ id: 'pr_d', status: 'draft', kind: 'return_goods', origin: 'goods_check', lines: [] }],
		});
		expect(await service.void('pe_1', reason, 'adm_b')).toMatchObject({
			status: 'void',
			voidReason: 'Wrong supplier',
		});
		expect(moves.filter((m) => 'quantityDelta' in m).map((m) => [m['productId'], m['quantityDelta']])).toEqual([
			['p1', -10],
			['', -2],
		]);
		expect(orderSaves[0]).toMatchObject({ status: 'sent', linkedEntryIds: ['pe_0'] });
		expect((orderSaves[0]?.['lines'] as Row[])[0]).toMatchObject({
			receivedQuantity: 5,
			receivedOn: [{ entryId: 'pe_0' }],
		});
		expect((orderSaves[0]?.['lines'] as Row[])[1]).toMatchObject({ receivedQuantity: 0, receivedOn: [] });
		expect(removedReturns).toEqual(['pr_d']);
		expect(books.purchaseEntryVoided).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'void' }),
			{},
			'adm_b',
		);
		expect(audit[0]?.text).toContain('voided PE/26-27/000007 (Bose Textiles, B-77): stock −');
		expect(audit[0]?.text).toContain('across 3 SKUs.');
		expect(outbox).toHaveLength(1);
	});

	it('voids with one layer and no number, an order gone or still open, and no search queue', async () => {
		const one = setupEntries({
			entries: [posted({ number: null, purchaseOrderId: 'po_x' })],
			layers: [layer()],
			outbox: 'none',
		});
		await one.service.void('pe_1', reason, null);
		expect(one.audit[0]?.text).toContain('voided the entry (Bose Textiles, B-77)');
		expect(one.audit[0]?.text).toContain('across 1 SKU.');
		expect(one.orderSaves).toEqual([]);
		const open = setupEntries({
			entries: [posted({ purchaseOrderId: 'po_1' })],
			orders: [{ id: 'po_1', status: 'sent', version: 1, linkedEntryIds: [], lines: [] }],
			layers: [layer()],
			outbox: 'fails',
		});
		await open.service.void('pe_1', reason, null);
		expect(open.orderSaves[0]?.['status']).toBe('sent');
	});

	it('voids an entry that came with no purchase order', async () => {
		const plain = setupEntries({ entries: [posted()], layers: [layer()] });
		expect(await plain.service.void('pe_1', reason, null)).toMatchObject({ status: 'void' });
		expect(plain.orderSaves).toEqual([]);
	});

	it('turns held stock into words, and passes other failures on', async () => {
		const held = setupEntries({
			entries: [posted()],
			layers: [layer()],
			moveFails: new StockMovementRefusedError('v1'),
		});
		expect(await refusal(held.service.void('pe_1', reason, null))).toEqual(['void_held']);
		const down = setupEntries({ entries: [posted()], layers: [layer()], moveFails: new Error('db down') });
		expect(await refusal(down.service.void('pe_1', reason, null))).toEqual(['db down']);
	});
});

describe('paying a bill', () => {
	const posted = (o: Row = {}) => entryOf({ status: 'posted', number: 'PE/26-27/000007', postedBy: 'adm_a', ...o });
	const write = (o: Row = {}) =>
		({ amountINR: 500, paidOn: '2026-11-24', mode: 'upi', reference: 'UTR 1', proofAssetId: null, ...o }) as never;

	it('lists a bill’s payments', async () => {
		const { service } = setupEntries({ payments: [{ id: 'pay_1' }] });
		expect(await service.paymentsFor('pe_1')).toEqual([{ id: 'pay_1' }]);
	});

	it('refuses a draft, more than is left, a future day, closed books, a step not theirs or the same person', async () => {
		expect(await refusal(setupEntries().service.recordPayment('pe_1', write(), null))).toEqual(['wrong_status']);
		const e = [posted()];
		expect(
			await refusal(
				setupEntries({ entries: e }).service.recordPayment('pe_1', write({ amountINR: 2_000 }), null),
			),
		).toEqual(['overpayment']);
		const over = await setupEntries({ entries: [posted({ paidINR: 1_100 })] })
			.service.recordPayment('pe_1', write(), null)
			.catch((x: unknown) => x);
		expect(issues(over)[0]?.message).toBe('Only ₹0 is left to pay on this bill.');
		expect(
			await refusal(
				setupEntries({ entries: e }).service.recordPayment('pe_1', write({ paidOn: '2026-12-01' }), null),
			),
		).toEqual(['paid_in_future']);
		expect(
			await refusal(
				setupEntries({ entries: e, settings: { booksClosedUpTo: '2026-11-30' } }).service.recordPayment(
					'pe_1',
					write(),
					null,
				),
			),
		).toEqual(['books_closed']);
		expect(
			await refusal(
				setupEntries({ entries: e, stepProblem: 'payment' }).service.recordPayment('pe_1', write(), null),
			),
		).toEqual(['step_role']);
		expect(
			await refusal(
				setupEntries({
					entries: e,
					settings: { stepRules: { paymentByDifferentPerson: true } },
				}).service.recordPayment('pe_1', write(), 'adm_a'),
			),
		).toEqual(['same_person']);
	});

	it('records a payment with its posting, by each way of paying', async () => {
		for (const [mode, words] of [
			['bank_transfer', 'bank transfer'],
			['upi', 'UPI'],
			['cheque', 'cheque'],
			['cash', 'cash'],
		] as const) {
			const { service, books, audit, paymentSaves } = setupEntries({ entries: [posted()] });
			const paid = await service.recordPayment(
				'pe_1',
				write({ mode, reference: mode === 'cash' ? null : 'R1' }),
				'adm_b',
			);
			expect(paid).toMatchObject({ paidINR: 500, paymentStatus: 'part_paid' });
			expect(books.supplierPaid).toHaveBeenCalledWith(
				paymentSaves[0],
				expect.objectContaining({ id: 'pe_1' }),
				{},
				'adm_b',
			);
			expect(audit[0]?.text).toContain(`by ${words}${mode === 'cash' ? '.' : ', ref R1.'}`);
		}
	});

	it('reverses a payment with its posting, and refuses one gone, of another bill, reversed or in closed books', async () => {
		const pay = { id: 'pay_1', purchaseEntryId: 'pe_1', amountINR: 500, paidOn: '2026-11-22', reversedAt: null };
		const e = [posted({ paidINR: 500 })];
		expect(await refusal(setupEntries({ entries: e }).service.reversePayment('pe_1', 'pay_x', 'x', null))).toEqual([
			'Payment not found',
		]);
		expect(
			await refusal(
				setupEntries({ entries: e, payments: [{ ...pay, purchaseEntryId: 'pe_2' }] }).service.reversePayment(
					'pe_1',
					'pay_1',
					'x',
					null,
				),
			),
		).toEqual(['Payment not found']);
		expect(
			await refusal(
				setupEntries({ entries: e, payments: [{ ...pay, reversedAt: at }] }).service.reversePayment(
					'pe_1',
					'pay_1',
					'x',
					null,
				),
			),
		).toEqual(['already_reversed']);
		expect(
			await refusal(
				setupEntries({
					entries: e,
					payments: [pay],
					settings: { booksClosedUpTo: '2026-11-22' },
				}).service.reversePayment('pe_1', 'pay_1', 'x', null),
			),
		).toEqual(['books_closed']);
		const { service, books, paymentSaves, audit } = setupEntries({ entries: e, payments: [pay] });
		expect(await service.reversePayment('pe_1', 'pay_1', 'Paid twice', 'adm_b')).toMatchObject({
			paidINR: 0,
			paymentStatus: 'unpaid',
		});
		expect(paymentSaves[0]).toMatchObject({ reversedBy: 'adm_b', reverseReason: 'Paid twice' });
		expect(books.supplierPaymentReversed).toHaveBeenCalledWith(paymentSaves[0], {}, 'adm_b');
		expect(audit[0]?.text).toContain('reversed the ₹500 payment of 2026-11-22 on PE/26-27/000007: "Paid twice"');
		const over = setupEntries({ entries: [posted({ paidINR: 100 })], payments: [pay] });
		expect(await over.service.reversePayment('pe_1', 'pay_1', 'x', null)).toMatchObject({ paidINR: 0 });
	});
});

describe('the list and the story', () => {
	it('lists entries with the tiles over the whole book', async () => {
		const due = (o: Row) => entryOf({ status: 'posted', ...o });
		const { service } = setupEntries({
			entries: [
				entryOf({ lines: [lineOf(), lineOf({ lineId: 'm', soldBy: 'metre', quantity: 25 })] }),
				due({ id: 'pe_2', paidINR: 50 }),
			],
			payables: [
				due({ id: 'pe_3', dueOn: '2026-11-30', supplierName: 'Later' }),
				due({ id: 'pe_4', dueOn: '2026-11-25', supplierName: 'Soon' }),
				due({ id: 'pe_5', dueOn: '2026-12-25' }),
				due({ id: 'pe_6', paidINR: 1_050 }),
			],
			monthly: [due({ totals: { ...(entryOf()['totals'] as Row), totalINR: 1_050.5, pieces: 4 } })],
		});
		const listed = (await service.list({ filter: 'open', page: 1, pageSize: 25 } as never)) as unknown as {
			items: Row[];
			tiles: Row;
		};
		expect(listed.items.map((row) => [row['pieces'], row['leftINR']])).toEqual([
			[10, 0],
			[10, 1_000],
		]);
		expect(listed.tiles).toMatchObject({
			boughtThisMonthINR: 1_050.5,
			postedThisMonth: 1,
			piecesThisMonth: 4,
			owedINR: 3_150,
			owedBills: 3,
			dueIn7DaysINR: 2_100,
			dueIn7DaysNext: { supplierName: 'Soon', dueOn: '2026-11-25' },
			drafts: 3,
		});
		const empty = setupEntries({ counts: {} });
		const tiles = ((await empty.service.list({ filter: 'all' } as never)) as unknown as { tiles: Row }).tiles;
		expect(tiles).toMatchObject({ dueIn7DaysNext: null, drafts: 0 });
	});

	it('reads an entry’s story', async () => {
		expect(await setupEntries().service.activity('pe_1')).toEqual([{ type: 'purchase_entry', ids: ['pe_1'] }]);
	});
});
