import { describe, expect, it, vi } from 'vitest';

import { openingStockData, stockCountData } from '../src/documents/record-prints';
import { StockPrints } from '../src/purchasing/stock-prints';

// The print builders belong to the documents chunk; here only what StockPrints hands them is checked.
vi.mock('../src/documents/record-prints', () => ({
	openingStockData: vi.fn(() => ({ doc: 'openingStock' })),
	stockCountData: vi.fn(() => ({ doc: 'stockCount' })),
}));
vi.mock('../src/documents/document-previews', () => ({
	previewDocument: () => ({ seller: { name: 'Saha Textile', lines: [] } }),
}));

const seller = { name: 'Saha Textile', lines: [] };
const formats = {
	seller: vi.fn(async (fallback: unknown) => fallback),
	renderActive: vi.fn(async () => new Uint8Array([1])),
};
const count = { number: 'SC/26-27/000001' };
const load = {
	id: 'os_1',
	number: 'OS/26-27/000001',
	rows: [{ sku: 'SAR-1' }, { sku: 'SAR-2' }, { sku: 'SAR-3' }],
};
const prints = (loads: unknown[] = [load]) =>
	new StockPrints(
		{
			bySku: async () =>
				new Map([
					['SAR-1', { title: { en: 'Baluchari' }, optionsLabel: 'maroon', soldBy: 'piece' }],
					['SAR-2', { title: { bn: 'বালুচরী' }, optionsLabel: '', soldBy: 'piece' }],
					['SAR-3', { title: {}, optionsLabel: '', soldBy: 'metre' }],
				]),
		} as never,
		{ list: async () => loads } as never,
		{ get: async () => count } as never,
		formats as never,
	);

describe('stock prints', () => {
	it('prints the count as the reader may see it, named by its number', async () => {
		const file = await prints().countSheet('sc_1', undefined);
		expect(file.fileName).toBe('stock-count-SC-26-27-000001.pdf');
		expect(stockCountData).toHaveBeenCalledWith(count, seller);
		expect(formats.renderActive).toHaveBeenLastCalledWith('stockCount', { doc: 'stockCount' });
	});

	it('names each opening-stock item in English, another language or by its SKU, with cost only for stock.cost', async () => {
		const file = await prints().openingStock('os_1', { permissions: ['stock.cost'] } as never);
		expect(file.fileName).toBe('opening-stock-OS-26-27-000001.pdf');
		expect(openingStockData).toHaveBeenLastCalledWith(
			load,
			new Map([
				['SAR-1', { title: 'Baluchari · maroon', soldBy: 'piece' }],
				['SAR-2', { title: 'বালুচরী', soldBy: 'piece' }],
				['SAR-3', { title: 'SAR-3', soldBy: 'metre' }],
			]),
			true,
			seller,
		);
		await prints().openingStock('os_1', undefined);
		expect(vi.mocked(openingStockData).mock.lastCall?.[2]).toBe(false);
	});

	it('says a load it can’t find is missing', async () => {
		await expect(prints([]).openingStock('os_9', undefined)).rejects.toThrow('Opening stock not found');
	});
});
