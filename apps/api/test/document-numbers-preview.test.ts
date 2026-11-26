import { describe, expect, it, vi } from 'vitest';

import { DocumentNumbersService } from '../src/orders-setup/document-numbers.service';

/** The number a document would get, without taking it (accounts brief E1's "When posted it is numbered …"). */

describe('a series number previewed', () => {
	it('formats the next number without taking it or locking the series', async () => {
		const series = (prefix: string, reset: 'fy' | 'never', digits = 4) => ({
			prefix,
			separator: '/',
			includeFinancialYear: reset === 'fy',
			digits,
			reset,
		});
		const settings = {
			series: {
				stockAdjustment: series('SA', 'fy'),
				openingStock: series('OS', 'fy'),
				journal: series('JV', 'never', 6),
			},
		};
		const numbering = { get: vi.fn(async () => settings), lock: vi.fn() };
		const allocator = { next: vi.fn(), peek: vi.fn(async () => 4) };
		const numbers = new DocumentNumbersService(numbering as never, allocator as never);
		expect(await numbers.preview('stockAdjustment', new Date('2026-11-22T06:00:00.000Z'))).toBe('SA/26-27/0004');
		expect(allocator.peek).toHaveBeenCalledWith('doc:stockAdjustment', '2026-27');
		await numbers.preview('openingStock', new Date('2026-11-22T06:00:00.000Z'), 'gst_wb');
		expect(allocator.peek).toHaveBeenLastCalledWith('OS@gst_wb', '2026-27');
		expect(await numbers.preview('journal')).toBe('JV/000004');
		expect(allocator.peek).toHaveBeenLastCalledWith('doc:journal', 'all');
		expect(allocator.next).not.toHaveBeenCalled();
		expect(numbering.lock).not.toHaveBeenCalled();
	});
});

describe('numbers taken (the rest of the numbering service)', () => {
	const series = { prefix: 'PE', separator: '/', includeFinancialYear: true, digits: 6, reset: 'fy' };
	const make = (order: unknown, lockedTypes: string[] = []) => {
		const numbering = {
			get: vi.fn(async () => ({
				series: { purchaseEntry: series, receipt: { ...series, prefix: 'RC', reset: 'never' } },
				order,
				parcel: { letter: 'P', separator: '/' },
				return: { letter: 'R', separator: '/' },
				paymentRequest: { letter: 'Q', separator: '/' },
				lockedTypes,
			})),
			lock: vi.fn(async () => undefined),
		};
		const allocator = { next: vi.fn(async () => 7), peek: vi.fn() };
		return { numbers: new DocumentNumbersService(numbering as never, allocator as never), numbering, allocator };
	};
	const at = new Date('2026-11-22T06:00:00.000Z');

	it('takes a series number, scoped when asked, and locks the format the first time', async () => {
		const { numbers, numbering, allocator } = make({
			kind: 'randomGroups',
			prefix: 'ST',
			separator: '-',
			groups: [5],
		});
		expect(await numbers.issue('purchaseEntry', undefined, at)).toBe('PE/26-27/000007');
		expect(allocator.next).toHaveBeenCalledWith('PE', '2026-27', undefined);
		expect(numbering.lock).toHaveBeenCalledWith('purchaseEntry', undefined);
		await numbers.issue('receipt', undefined, at, 'gst_wb');
		expect(allocator.next).toHaveBeenLastCalledWith('doc:receipt@gst_wb', 'all', undefined);
		const locked = make({ kind: 'randomGroups', prefix: 'ST', separator: '-', groups: [5] }, ['purchaseEntry']);
		await locked.numbers.issue('purchaseEntry');
		expect(locked.numbering.lock).not.toHaveBeenCalled();
	});

	it('makes order numbers in each format, and children of an order', async () => {
		expect(
			await make({ kind: 'yearMonthRandom', prefix: 'ST', separator: '-', randomDigits: 6 }).numbers.orderNumber(
				undefined,
				at,
			),
		).toMatch(/^ST-2611-\d{6}$/);
		expect(
			await make({ kind: 'randomGroups', prefix: 'ST', separator: '-', groups: [5, 5] }).numbers.orderNumber(),
		).toMatch(/^ST-\d{5}-\d{5}$/);
		const sequenced = make({ kind: 'financialYearSequence', prefix: 'SO', separator: '/', digits: 6 });
		expect(await sequenced.numbers.orderNumber(undefined, at)).toBe('SO/26-27/000007');
		expect(sequenced.allocator.next).toHaveBeenCalled();
		const { numbers } = make({ kind: 'randomGroups', prefix: 'ST', separator: '-', groups: [5] });
		expect(await numbers.childNumber('parcel', 'ST-48213-90761', 1)).toBe('ST-48213-90761/P1');
		expect(await numbers.childNumber('paymentRequest', 'ST-48213-90761', 2)).toBe('ST-48213-90761/Q2');
	});
});
