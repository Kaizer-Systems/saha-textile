import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { CategoryService } from '@data-access/services/category.service';

import { DraftProductPopup, categoryPaths, wholeRupees } from './draft-product-popup';
import { ImportPopup } from './import-popup';
import { PostConfirm } from './post-confirm';

import type { PurchaseEntry, PurchaseItemOption } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({ downloads: [] as unknown[] }));
vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	downloadCsv: (...args: unknown[]) => void h.downloads.push(args),
}));

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
const transloco = { translate: t, getActiveLang: () => 'en', getTranslation: () => ({}) };

const item = (over: Partial<PurchaseItemOption> = {}) =>
	({
		productId: 'p1',
		variantId: 'v1',
		sku: 'ST-1',
		title: 'Red saree',
		optionsLabel: '',
		imageUrl: null,
		soldBy: 'piece',
		hsnCode: '5007',
		sellingPriceINR: 15900,
		lastCostINR: 8600,
		lastEntryNumber: null,
		supplierItemCode: null,
		disabled: false,
		...over,
	}) as PurchaseItemOption;

function mount<T>(type: new (...args: never[]) => T, gateway: object, extra: unknown[] = []) {
	const close = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: { close, dismiss: vi.fn() } },
			{ provide: PurchasingGateway, useValue: gateway },
			{ provide: TranslocoService, useValue: transloco },
			...(extra as never[]),
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return { popup: TestBed.createComponent(type).componentInstance, close };
}

describe('Post this entry: the confirmation (p09)', () => {
	const entry = {
		id: 'pe_1',
		version: 4,
		lines: [
			{ lineId: 'l1', sku: 'ST-1', accepted: 3, soldBy: 'piece' },
			{ lineId: 'l2', sku: 'ST-2', accepted: 25, soldBy: 'metre' },
			{ lineId: 'l3', sku: 'ST-3', accepted: null, soldBy: 'piece' },
		],
	} as unknown as PurchaseEntry;
	const preview = {
		warnings: [
			{ code: 'margin_floor', lineId: 'l1', values: { marginPct: 5, floorPct: 20, sellingPriceINR: 900 } },
			{ code: 'lookalike_bill', lineId: '', values: { billNumber: 'B/1' } },
			{ code: 'margin_floor', lineId: 'l9', values: {} },
		],
	};

	it('says nothing before it starts, then what goes into stock and each warning by its line', async () => {
		const post = vi.fn(() => of({ id: 'pe_1', status: 'posted' }));
		const { popup, close } = mount(PostConfirm, { post });
		expect([popup.intoStock(), popup.warningLines()]).toEqual(['', []]);
		await popup.post();
		expect(post).not.toHaveBeenCalled();
		popup.start(entry, preview as never);
		expect(popup.intoStock()).toEqual(expect.any(String));
		expect(popup.warningLines()).toEqual([
			expect.stringMatching(/^ST-1: warn_margin_floor/),
			'warn_lookalike_bill:{"bill":"B/1"}',
			expect.stringMatching(/^warn_margin_floor/),
		]);
		popup.busy.set(true);
		await popup.post();
		expect(post).not.toHaveBeenCalled();
		popup.busy.set(false);
		await popup.post();
		expect(post).toHaveBeenCalledWith('pe_1', {
			acceptWarningCodes: ['margin_floor', 'lookalike_bill'],
			requestKey: expect.stringMatching(/^post-/),
			version: 4,
		});
		expect(close).toHaveBeenCalledWith({ id: 'pe_1', status: 'posted' });
	});

	it('shows why posting was refused', async () => {
		const { popup } = mount(PostConfirm, {
			post: vi.fn(() => throwError(() => ({ error: { issues: [{ code: 'x', message: 'Books are closed' }] } }))),
		});
		popup.start(entry, preview as never);
		await popup.post();
		expect([popup.error(), popup.busy()]).toEqual(['Books are closed', false]);
	});
});

describe('New design arrived: a draft product (p05)', () => {
	const row = (id: string, name: Record<string, string>, parentId: string | null = null) =>
		({ id, name, slug: id, parentId }) as never;

	it('names categories by their path, in the reader’s language, falling back to English or the address', () => {
		const paths = categoryPaths(
			[
				row('sarees', { en: 'Sarees', bn: 'শাড়ি' }),
				row('silk', { en: 'Silk' }, 'sarees'),
				row('odd', {}, 'loop'),
				row('loop', { en: 'Loop' }, 'odd'),
			],
			'bn',
		);
		expect(Object.fromEntries(paths.map((path) => [path.id, path.label]))).toEqual({
			sarees: 'শাড়ি',
			silk: 'শাড়ি › Silk',
			odd: 'Loop › odd',
			loop: 'odd › Loop',
		});
		expect([wholeRupees('₹15,500'), wholeRupees('0'), wholeRupees('12.5')]).toEqual([15500, null, null]);
	});

	function draft(options: { rows?: unknown; gateway?: object } = {}) {
		const gateway = {
			draftProductDefaults: vi.fn(() => of({ skuPrefix: null })),
			createDraftProduct: vi.fn(() => of(item({ variantId: 'v_new' }))),
			...options.gateway,
		};
		const categories = { getCategoryRows: vi.fn(() => options.rows ?? of([row('silk', { en: 'Silk' })])) };
		return { ...mount(DraftProductPopup, gateway, [{ provide: CategoryService, useValue: categories }]), gateway };
	}

	it('checks the prices and the code prefix before it saves', async () => {
		const { popup, gateway, close } = draft();
		expect(popup.categoryOptions()).toEqual([{ id: 'silk', label: 'Silk' }]);
		popup.start('  Kanjeevaram gold  ', 'sup_1');
		await popup.save();
		expect(gateway.createDraftProduct).not.toHaveBeenCalled();
		await popup.chooseCategory('');
		expect(gateway.draftProductDefaults).not.toHaveBeenCalled();
		await popup.chooseCategory('silk');
		expect(popup.needsPrefix()).toBe(true);
		popup.selling.set('15,500');
		popup.mrp.set('abc');
		expect(popup.mrpProblem()).toBe('whole_rupees_only');
		popup.mrp.set('9,000');
		expect(popup.mrpProblem()).toBe('mrp_below_selling');
		popup.mrp.set('');
		expect([popup.mrpProblem(), popup.mrpValue()]).toEqual([null, null]);
		popup.mrp.set('18,000');
		expect(popup.mrpProblem()).toBeNull();
		popup.typedPrefix.set('bad prefix');
		expect(popup.canSave()).toBe(false);
		popup.typedPrefix.set(' kj ');
		popup.code.set(' K-118 ');
		await popup.save();
		expect(gateway.createDraftProduct).toHaveBeenCalledWith({
			name: 'Kanjeevaram gold',
			categoryId: 'silk',
			sellingPriceINR: 15500,
			mrpINR: 18000,
			supplierId: 'sup_1',
			supplierItemCode: 'K-118',
			soldBy: 'piece',
			skuPrefix: 'KJ',
		});
		expect(close).toHaveBeenCalledWith(expect.objectContaining({ variantId: 'v_new' }));
	});

	it('a category with its own prefix, no supplier and no code; refusals by field; categories that fail to load', async () => {
		const refusal = {
			error: {
				issues: [
					{ code: 'sku_taken', message: 'That code is taken', path: ['request', 'skuPrefix'] },
					{ code: 'other', message: 'Something else' },
				],
			},
		};
		const { popup, gateway } = draft({
			rows: throwError(() => new Error('down')),
			gateway: {
				draftProductDefaults: vi
					.fn()
					.mockReturnValueOnce(of({ skuPrefix: 'BAN' }))
					.mockReturnValueOnce(throwError(() => new Error('down'))),
				createDraftProduct: vi.fn(() => throwError(() => refusal)),
			},
		});
		expect(popup.categoryOptions()).toEqual([]);
		popup.start('Banarasi', null);
		await popup.chooseCategory('ban');
		popup.selling.set('9000');
		expect(popup.needsPrefix()).toBe(false);
		await popup.save();
		expect(gateway.createDraftProduct).toHaveBeenCalledWith(
			expect.objectContaining({ supplierItemCode: null, skuPrefix: null, mrpINR: null }),
		);
		expect(gateway.createDraftProduct).not.toHaveBeenCalledWith(expect.objectContaining({ supplierId: null }));
		expect(popup.fieldErrors()).toEqual({ skuPrefix: 'That code is taken' });
		expect([popup.error(), popup.saving()]).toEqual(['That code is taken', false]);
		await popup.chooseCategory('other');
		expect(popup.error()).toBe('purchasing_action_failed');
	});
});

describe('Import lines from a spreadsheet (p13)', () => {
	const result = {
		rows: [
			{
				row: 2,
				code: 'ST-1',
				quantity: 6,
				unitPriceINR: 9200,
				hsn: '',
				gstRatePct: null,
				result: 'ready',
				match: item(),
				problem: null,
			},
			{
				row: 3,
				code: 'NEW-1',
				quantity: 2.5,
				unitPriceINR: 400,
				hsn: '5208',
				gstRatePct: 12,
				result: 'needs_product',
				match: null,
				problem: null,
			},
			{
				row: 4,
				code: 'BAD',
				quantity: 0,
				unitPriceINR: -1,
				hsn: '',
				gstRatePct: null,
				result: 'problem',
				match: null,
				problem: null,
			},
		],
	};
	const csv = (name: string, text = 'SKU,Quantity,Unit price\nST-1,6,9200\n') => new File([text], name);

	function importer(gateway: object = {}, answers: unknown[] = []) {
		const modals = {
			open: vi.fn(() => {
				const next = answers.shift();
				const result = next ? Promise.resolve(next) : Promise.reject(new Error('closed'));
				result.catch(() => undefined);
				return { componentInstance: { start: vi.fn() }, result };
			}),
		};
		return {
			...mount(ImportPopup, { importRows: vi.fn(() => of(result)), ...gateway }, [
				{ provide: NgbModal, useValue: modals },
			]),
			modals,
		};
	}

	it('downloads the template, and reads a sheet only with a supplier and a CSV that has the columns', async () => {
		const { popup } = importer();
		popup.template();
		expect(h.downloads).toHaveLength(1);
		await popup.read(csv('lines.csv'));
		await popup.read(null);
		expect(popup.fileName()).toBe('');
		popup.start('sup_1');
		await popup.read(csv('lines.xlsx'));
		expect(popup.error()).toBe('import_csv_only');
		await popup.read(csv('lines.csv', 'Name\nx\n'));
		expect(popup.error()).toBe('import_columns_missing');
		await popup.read(csv('lines.csv'));
		expect(popup.counts()).toEqual({ ready: 1, needsProduct: 1, problems: 1 });
		expect(popup.problemKey(popup.rows()[2] as never)).toBe('import_problem_unknown');
	});

	it('gives a row a product picked or made here; Add sends only ready rows, and nothing when none are', async () => {
		const { popup, close, modals } = importer({}, [undefined, item({ variantId: 'v_made', soldBy: 'metre' })]);
		popup.add();
		expect(close).not.toHaveBeenCalled();
		popup.start('sup_1');
		await popup.read(csv('lines.csv'));
		await popup.draft(9);
		expect(modals.open).not.toHaveBeenCalled();
		await popup.draft(1);
		expect(popup.rows()[1]?.picked).toBeNull();
		await popup.draft(1);
		expect(popup.counts().ready).toBe(2);
		popup.picking.set(0);
		popup.pick(0, item({ variantId: 'v_other' }));
		expect(popup.picking()).toBeNull();
		popup.add();
		expect(close).toHaveBeenCalledWith([
			expect.objectContaining({ variantId: 'v_other', quantity: '6', gstRatePct: 5 }),
			expect.objectContaining({ variantId: 'v_made', quantity: '2.5', gstRatePct: 12, hsnOnBill: '5208' }),
		]);
	});

	it('says why the sheet could not be read', async () => {
		const { popup } = importer({ importRows: vi.fn(() => throwError(() => new Error('down'))) });
		popup.start('sup_1');
		await popup.read(csv('lines.csv'));
		expect([popup.error(), popup.busy(), popup.rows()]).toEqual(['purchasing_action_failed', false, []]);
	});
});
