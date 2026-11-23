import { describe, expect, it } from 'vitest';

import { CompanyProfileSave, FeatureSwitchesSave } from '../src/company';
import { EDocActivityQuery, EDocListQuery, EDocSettingsSave, Irn } from '../src/edocs';
import { FreeWith } from '../src/free-with';
import { StockAdjustmentWrite } from '../src/inventory';
import { LocationActiveWrite, LocationChipWrite, LocationWrite } from '../src/locations';
import { PRODUCT_DRAFT_MAX_BYTES, ProductDraftWrite } from '../src/product-draft';

describe('shared admin route contracts', () => {
	it('requires the company revision and accepts partial feature switches', () => {
		expect(CompanyProfileSave.parse({ profile: { kind: 'partnership' }, expectedUpdatedAt: null })).toMatchObject({
			profile: { kind: 'partnership' },
			expectedUpdatedAt: null,
		});
		expect(CompanyProfileSave.safeParse({ profile: { kind: 'partnership' } }).success).toBe(false);
		expect(FeatureSwitchesSave.parse({ on: { locations: true }, expectedUpdatedAt: 'revision' })).toEqual({
			on: { locations: true },
			expectedUpdatedAt: 'revision',
		});
		expect(FeatureSwitchesSave.safeParse({ on: { locations: 'true' }, expectedUpdatedAt: null }).success).toBe(
			false,
		);
	});

	it('validates electronic-document pagination, filters and settings', () => {
		expect(EDocListQuery.parse({ kind: 'eWayBill', page: '2', q: '  INV-1  ' })).toEqual({
			kind: 'eWayBill',
			page: 2,
			q: 'INV-1',
			pageSize: 25,
		});
		expect(EDocListQuery.safeParse({ kind: 'eInvoice', from: '11/23/2026', pageSize: 101 }).success).toBe(false);
		expect(EDocActivityQuery.parse({})).toEqual({ page: 1 });
		expect(EDocActivityQuery.safeParse({ page: 0 }).success).toBe(false);
		expect(EDocSettingsSave.parse({ settings: {}, expectedUpdatedAt: null }).settings.eInvoicePath).toBe('manual');
		expect(
			EDocSettingsSave.safeParse({ settings: { eInvoicePath: 'ewbDirect' }, expectedUpdatedAt: null }).success,
		).toBe(false);
		expect(Irn.parse('A'.repeat(64))).toBe('a'.repeat(64));
	});

	it('uses an explicit null for all locations and a boolean for location status', () => {
		expect(LocationChipWrite.parse({ locationId: null })).toEqual({ locationId: null });
		expect(LocationChipWrite.safeParse({ locationId: '' }).success).toBe(false);
		expect(LocationActiveWrite.parse({ active: false })).toEqual({ active: false });
		expect(LocationActiveWrite.safeParse({ active: 'false' }).success).toBe(false);
		expect(LocationWrite.parse({ name: 'Store', shortCode: ' bRS ', stateCode: '19' }).shortCode).toBe('BRS');
	});
});

describe('catalogue draft and stock write constraints', () => {
	it('keeps unfinished form values but refuses a draft with the wrong identity or excessive size', () => {
		const form = { title: '', productType: 'unfinished' };
		expect(ProductDraftWrite.parse({ kind: 'new', form }).form).toEqual(form);
		expect(ProductDraftWrite.parse({ kind: 'edit', productId: 'p1', form }).productId).toBe('p1');
		expect(ProductDraftWrite.safeParse({ kind: 'new', productId: 'p1', form }).success).toBe(false);
		expect(ProductDraftWrite.safeParse({ kind: 'edit', form }).success).toBe(false);
		expect(
			ProductDraftWrite.safeParse({ kind: 'new', form: { text: 'x'.repeat(PRODUCT_DRAFT_MAX_BYTES) } }).success,
		).toBe(false);
	});

	it('distinguishes duplicate free items and invalid selection bounds', () => {
		const items = [{ productId: 'p1' }, { productId: 'p1', variantId: 'v1', quantity: 2 }];
		expect(FreeWith.parse({ items, take: 'between', from: 0, count: 2 }).items).toEqual([
			{ productId: 'p1', variantId: null, quantity: 1 },
			{ productId: 'p1', variantId: 'v1', quantity: 2 },
		]);
		expect(FreeWith.safeParse({ items: [items[0], items[0]] }).success).toBe(false);
		expect(FreeWith.safeParse({ items, take: 'exactly' }).success).toBe(false);
		expect(FreeWith.safeParse({ items, take: 'upto', count: 3 }).success).toBe(false);
		expect(FreeWith.safeParse({ items, take: 'between', count: 2 }).success).toBe(false);
		expect(FreeWith.safeParse({ items, take: 'between', from: 2, count: 1 }).success).toBe(false);
		expect(FreeWith.safeParse({ items, take: 'between', from: 2 }).success).toBe(false);
	});

	it('requires the action-specific reason, hold and note fields', () => {
		const input = { variantId: 'v1', quantity: 1, requestKey: 'test-key-1', note: '' };
		const messages = (action: string, fields: Record<string, string> = {}) =>
			StockAdjustmentWrite.safeParse({ ...input, action, ...fields }).error?.issues.map(({ message }) => message);
		expect(messages('remove')).toEqual(['reason_required', 'note_required']);
		expect(messages('add', { reasonCode: 'damage' })).toEqual(['reason_not_for_action']);
		expect(messages('add', { reasonCode: 'other' })).toEqual(['note_required']);
		expect(messages('remove', { reasonCode: 'damage', note: 'Torn fabric' })).toBeUndefined();
		expect(messages('hold')).toEqual(['hold_reason_required']);
		expect(messages('hold', { holdReason: 'quality_check' })).toBeUndefined();
		expect(messages('release')).toEqual(['hold_required']);
		expect(messages('release', { holdId: 'hold-1' })).toBeUndefined();
	});
});
