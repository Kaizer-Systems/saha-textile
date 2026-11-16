import { describe, expect, it } from 'vitest';

import { OPENING_PILL, openingRows, sheetDate } from './opening-stock';

describe('opening stock sheet (o01)', () => {
	it('reads the dates people type and refuses impossible ones', () => {
		expect(sheetDate('2026-03-14')).toBe('2026-03-14');
		expect(sheetDate('14/03/2026')).toBe('2026-03-14');
		expect(sheetDate('4-3-2026')).toBe('2026-03-04');
		expect(sheetDate('14.03.2026')).toBe('2026-03-14');
		expect(sheetDate('31/02/2026')).toBeNull();
		expect(sheetDate('2026-13-01')).toBeNull();
		expect(sheetDate('March 14')).toBeNull();
	});

	it('finds columns by heading, keeps sheet row numbers, and skips blank SKUs', () => {
		const sheet = openingRows([
			['Note', 'SKU', 'Quantity', 'Cost each', 'Received on'],
			['first shelf', 'ST-BAN-0412', '2', '₹8,200', '14/03/2026'],
			['', '', '', '', ''],
			['', 'ST-FAB-0007', '42.5', '160', ''],
			['', 'ST-BAL-0108', '1,200', '', '2026-03-14'],
		]);
		expect(sheet.problem).toBeNull();
		expect(sheet.rows).toEqual([
			{
				row: 2,
				sku: 'ST-BAN-0412',
				quantity: 2,
				unitCostINR: 8200,
				receivedOn: '2026-03-14',
				note: 'first shelf',
			},
			{ row: 4, sku: 'ST-FAB-0007', quantity: 42.5, unitCostINR: 160, receivedOn: null, note: '' },
			{ row: 5, sku: 'ST-BAL-0108', quantity: 1200, unitCostINR: null, receivedOn: '2026-03-14', note: '' },
		]);
	});

	it('takes "Pieces" or "Metres" as the quantity heading and leaves cost empty when the column is missing', () => {
		const sheet = openingRows([
			['sku', 'Metres'],
			['ST-FAB-0007', '12.5'],
		]);
		expect(sheet.rows[0]).toMatchObject({ quantity: 12.5, unitCostINR: null, receivedOn: null });
		expect(
			openingRows([
				['SKU', 'Pieces'],
				['ST-1', 'two'],
			]).rows[0]?.quantity,
		).toBe(0);
	});

	it('says what is wrong with a sheet that cannot be checked', () => {
		expect(openingRows([]).problem?.key).toBe('import_empty');
		expect(openingRows([['Item', 'Cost']]).problem?.key).toBe('opening_columns_missing');
		expect(openingRows([['SKU', 'Quantity']]).problem?.key).toBe('import_empty');
		const dated = openingRows([
			['SKU', 'Quantity', 'Received on'],
			['ST-1', '1', '31/02/2026'],
			['ST-2', '1', '2026-03-14'],
			['ST-3', '1', 'yesterday'],
		]);
		expect(dated.problem).toEqual({ key: 'opening_date_unreadable', params: { rows: '2, 4' } });
	});

	it('marks only Ready green and Cost missing amber', () => {
		expect(OPENING_PILL.ready).toBe('completed');
		expect(OPENING_PILL.cost_missing).toBe('pending');
		expect(OPENING_PILL.date_invalid).toBe('danger');
	});
});
