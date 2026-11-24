import { describe, expect, it, vi } from 'vitest';

import { StockAdjustmentBooks, type AdjustmentToPost } from '../src/purchasing/stock-adjustment-books';

/** Numbered stock adjustments in the books (accounts brief D5, E1, E3). */

const writeOff: AdjustmentToPost = {
	id: 'adj_1',
	action: 'remove',
	quantity: 2,
	reasonCode: 'damage',
	outcome: 'writtenOff',
	hsnCode: '5208',
	valueINR: 620,
};

function setup(willPost = true) {
	const numbers = {
		issue: vi.fn(async () => 'SA/26-27/0004'),
		preview: vi.fn(async (type: string) => (type === 'journal' ? 'JV/26-27/000013' : 'SA/26-27/0004')),
	};
	const books = {
		stockAdjusted: vi.fn(async () => ({ journalNumber: 'JV/26-27/000013', itcINR: 31 })),
		willPost: vi.fn(async () => willPost),
		stockAdjustmentReversed: vi.fn(async () => 'JV/26-27/000014'),
	};
	return { service: new StockAdjustmentBooks(numbers as never, books as never), numbers, books };
}

describe('stock adjustments numbered and posted (D5)', () => {
	it('takes the SA number inside the transaction and posts with the item’s GST rate at its cost', async () => {
		const { service, numbers, books } = setup();
		const at = new Date('2026-11-22T06:00:00.000Z');
		const number = await service.number({ tx: 1 } as never, at);
		expect(await service.posted(writeOff, number, { tx: 1 } as never, 'adm_owner', at)).toEqual({
			number: 'SA/26-27/0004',
			outcome: 'writtenOff',
			itcReversedINR: 31,
			journalNumber: 'JV/26-27/000013',
		});
		expect(numbers.issue).toHaveBeenCalledWith('stockAdjustment', { tx: 1 }, at);
		expect(books.stockAdjusted).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'adj_1', number: 'SA/26-27/0004', ratePercent: 5, at: at.toISOString() }),
			{ tx: 1 },
			'adm_owner',
		);
		await service.number({} as never);
		await service.posted({ ...writeOff, hsnCode: null }, number, {} as never, null);
		expect(books.stockAdjusted).toHaveBeenLastCalledWith(expect.objectContaining({ ratePercent: 0 }), {}, null);
	});

	it('shows E1’s numbers and tax without taking them, and only the SA number before the books are set up', async () => {
		const { service } = setup();
		expect(await service.preview(writeOff)).toEqual({
			number: 'SA/26-27/0004',
			itcINR: 31,
			journalNumber: 'JV/26-27/000013',
		});
		expect(await service.preview({ ...writeOff, outcome: 'keptDamaged' })).toMatchObject({ itcINR: null });
		expect(await setup(false).service.preview(writeOff)).toEqual({
			number: 'SA/26-27/0004',
			itcINR: null,
			journalNumber: null,
		});
	});

	it('numbers a reversal and posts the voucher reversing the original’s (E3)', async () => {
		const { service, numbers, books } = setup();
		const ctx = { tx: 1 } as never;
		numbers.issue.mockResolvedValueOnce('SA/26-27/0005');
		const at = new Date('2026-11-24T05:00:00.000Z');
		expect(await service.reversed({ id: 'adj_1', number: 'SA/26-27/0004' }, 'adj_2', ctx, 'adm_1', at)).toEqual({
			number: 'SA/26-27/0005',
			journalNumber: 'JV/26-27/000014',
		});
		expect(numbers.issue).toHaveBeenCalledWith('stockAdjustment', ctx, at);
		expect(books.stockAdjustmentReversed).toHaveBeenCalledWith(
			{
				id: 'adj_1',
				number: 'SA/26-27/0004',
				reversalId: 'adj_2',
				reversalNumber: 'SA/26-27/0005',
				at: '2026-11-24T05:00:00.000Z',
			},
			ctx,
			'adm_1',
		);
		await service.reversed({ id: 'adj_1', number: 'SA/26-27/0004' }, 'adj_3', ctx, null);
		expect(await service.nextNumber(at)).toBe('SA/26-27/0004');
		expect(numbers.preview).toHaveBeenLastCalledWith('stockAdjustment', at);
		await service.nextNumber();
	});
});
