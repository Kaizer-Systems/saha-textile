import { TestBed } from '@angular/core/testing';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmPopup } from './confirm-popup';
import { askConfirm, askConfirmComment, askReason, askYesNo } from './popups';
import { linesQuantity, returnStatus, returnWhy, unitsText } from './purchasing-labels';
import { importRows } from './sheet-rows';
import { entryStep } from '../purchase-entry/entry-steps';
import { adjust, countBody, countFrom, countProblem } from '../purchase-entry/goods-check';
import { VoidRefused } from '../purchase-entry/void-refused';
import { CapPopup } from '../purchase-return/cap-popup';

import type { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import type { PurchaseEntry, PurchaseReturn } from '@saha-textile/contracts';

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

describe('how far an entry is', () => {
	it('reads every state, and a void entry where it stopped', () => {
		const step = (over: Record<string, unknown>) =>
			entryStep({ status: 'void', paymentStatus: 'unpaid', postedAt: null, checkedAt: null, ...over } as never);
		expect([
			step({ status: 'draft' }),
			step({ status: 'checked' }),
			step({ status: 'posted' }),
			step({ status: 'posted', paymentStatus: 'paid' }),
			step({ postedAt: '2026-11-20' }),
			step({ checkedAt: '2026-11-20' }),
			step({}),
		]).toEqual([0, 1, 2, 3, 2, 1, 0]);
	});
});

describe('the goods check', () => {
	const entry = {
		lines: [
			{
				lineId: 'l1',
				quantity: 6,
				soldBy: 'piece',
				accepted: null,
				damaged: 1,
				missing: 0,
				damageReason: null,
				damageNote: null,
				damagePhotoAssetIds: ['med_1'],
			},
		],
	} as unknown as PurchaseEntry;

	it('starts from the bill, names photos by their id, and keeps a typed nonsense number at zero', () => {
		const [line] = countFrom(entry);
		if (!line) throw new Error('One line was expected.');
		expect(line).toMatchObject({
			good: 6,
			reason: 'damaged_on_arrival',
			note: '',
			photos: [{ assetId: 'med_1', name: 'med_1' }],
		});
		expect(adjust(line, 'good', Number.NaN)).toMatchObject({ good: 0, damaged: 1, missing: 5 });
		expect(countProblem(line)).toBe('count_must_add_up');
		const body = countBody([{ ...line, good: 5, note: '  ' }], 3);
		expect(body.lines[0]).toMatchObject({ damageNote: null, damagePhotoAssetIds: ['med_1'] });
	});
});

describe('the small popups', () => {
	const mount = <T>(type: new () => T) => {
		const modal = { close: vi.fn(), dismiss: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: NgbActiveModal, useValue: modal }] });
		TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
		return { popup: TestBed.createComponent(type).componentInstance, modal };
	};

	it('hold what they were started with', () => {
		const refused = mount(VoidRefused).popup;
		refused.start([{ code: 'stock_moved', message: 'Sold already', target: 'l1' }]);
		expect(refused.rows()).toHaveLength(1);
		const cap = mount(CapPopup).popup;
		cap.start({ lineId: 'l1', freeToReturn: 2 } as never);
		expect(cap.line()).toMatchObject({ freeToReturn: 2 });
	});

	it('answers yes plainly, or with the comment trimmed when it asks for one', () => {
		const plain = mount(ConfirmPopup);
		plain.popup.start({ title: 'x', yes: 'yes' } as never);
		plain.popup.yes();
		expect(plain.modal.close).toHaveBeenCalledWith(true);
		const commented = mount(ConfirmPopup);
		commented.popup.start({ title: 'x', yes: 'yes', comment: { label: 'why' } } as never);
		commented.popup.comment.set('  late delivery ');
		commented.popup.yes();
		expect(commented.modal.close).toHaveBeenCalledWith({ comment: 'late delivery' });
	});
});

describe('asking through a popup', () => {
	const modals = (result: Promise<unknown>) =>
		({ open: vi.fn(() => ({ componentInstance: { start: vi.fn() }, result })) }) as unknown as NgbModal;
	const closed = () => Promise.reject(new Error('closed'));

	it('gives the reason, yes or no, or nothing when closed', async () => {
		await expect(askReason(modals(Promise.resolve('done')), {} as never)).resolves.toBe('done');
		await expect(askReason(modals(closed()), {} as never)).resolves.toBeNull();
		await expect(askConfirm(modals(Promise.resolve(true)), {} as never)).resolves.toBe(true);
		await expect(askConfirm(modals(closed()), {} as never)).resolves.toBe(false);
		await expect(askYesNo(modals(Promise.resolve('maybe')), {} as never)).resolves.toBeNull();
		await expect(askYesNo(modals(closed()), {} as never)).resolves.toBeNull();
	});

	it('gives the comment only when the answer carries one', async () => {
		const ask = { comment: { label: 'why' } } as never;
		await expect(askConfirmComment(modals(Promise.resolve({ comment: 'ok' })), ask)).resolves.toEqual({
			comment: 'ok',
		});
		for (const answer of [null, 'yes', { other: 1 }])
			await expect(askConfirmComment(modals(Promise.resolve(answer)), ask)).resolves.toBeNull();
		await expect(askConfirmComment(modals(closed()), ask)).resolves.toBeNull();
	});
});

describe('purchasing words', () => {
	const count = (key: string, n: number) => `${n} ${key}`;
	const ret = (over: Record<string, unknown>) =>
		({
			status: 'settled',
			settledINR: 0,
			settlements: [],
			reason: 'damaged',
			origin: 'staff',
			...over,
		}) as unknown as PurchaseReturn;

	it('joins pieces and metres the reader’s way, and writes metres alone', () => {
		expect(linesQuantity([{ quantity: 125, soldBy: 'metre' }], count, t, 'bn')).toContain('unit_metres');
		expect(unitsText([{ quantity: 125, soldBy: 'metre' }], t)).toBe('unit_metres:{"value":"12.5"}');
	});

	it('names how a return settled, with or without a credit note number, and why it was made', () => {
		expect(returnStatus(ret({}), t).label).toBe('pr_status_settled_how:{"how":""}');
		expect(returnStatus(ret({ settlements: [{ how: 'credit_note', reference: null }] }), t).label).toBe(
			'pr_status_settled_how:{"how":"settled_how_credit_note"}',
		);
		expect(returnWhy(ret({}), t)).toBe('pr_reason_damaged');
	});
});

describe('importing a sheet', () => {
	it('reads a sheet without HSN or GST columns, skips rows with no code, and names a sheet of none', () => {
		const { rows } = importRows([['Code', 'Qty', 'Price'], ['ST-1', '2', '₹1,200'], ['ST-2']]);
		expect(rows).toEqual([
			{ row: 2, code: 'ST-1', quantity: 2, unitPriceINR: 1200, hsn: '', gstRatePct: null },
			{ row: 3, code: 'ST-2', quantity: 0, unitPriceINR: -1, hsn: '', gstRatePct: null },
		]);
		expect(
			importRows([
				['Code', 'Qty', 'Price'],
				['', '1', '1'],
			]),
		).toEqual({ rows: [], problem: 'import_empty' });
		expect(importRows([['Name', 'Qty']])).toEqual({ rows: [], problem: 'import_columns_missing' });
		// A row that stops before the code column has no code.
		expect(
			importRows([
				['Qty', 'Price', 'Code'],
				['1', '2'],
			]),
		).toEqual({ rows: [], problem: 'import_empty' });
	});
});
