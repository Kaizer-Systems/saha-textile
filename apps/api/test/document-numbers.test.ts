import { DEFAULT_DOCUMENT_NUMBERING, type DocumentNumberingSettings } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { DocumentNumbersService } from '../src/orders-setup/document-numbers.service';

const AT = new Date('2026-11-20T06:00:00.000Z');

function service(settings: Partial<DocumentNumberingSettings> = {}) {
	const counters: Array<[string, string]> = [];
	const lock = vi.fn(async () => undefined);
	const svc = new DocumentNumbersService(
		{ get: async () => ({ ...structuredClone(DEFAULT_DOCUMENT_NUMBERING), ...settings }), lock } as never,
		{
			next: async (series: string, period: string) => {
				counters.push([series, period]);
				return 7;
			},
		} as never,
	);
	return { svc, counters, lock };
}

describe('document numbers', () => {
	it('numbers a GST document in its year, a purchases document on its old counter, per registration when asked', async () => {
		const { svc, counters, lock } = service();
		expect(await svc.issue('taxInvoice', undefined, AT, '19AAAAA0000A1Z5')).toMatch(/7$/);
		expect(await svc.issue('purchaseEntry', undefined, AT)).toMatch(/7$/);
		expect(counters).toEqual([
			['doc:taxInvoice@19AAAAA0000A1Z5', '2026-27'],
			['PE', '2026-27'],
		]);
		expect(lock).toHaveBeenCalledWith('taxInvoice', undefined);
	});

	it('counts for ever in a series that never restarts, and locks a type only once', async () => {
		const base = structuredClone(DEFAULT_DOCUMENT_NUMBERING);
		const { svc, counters, lock } = service({
			series: { ...base.series, journal: { ...base.series.journal, reset: 'never' } },
			lockedTypes: ['journal'],
		});
		await svc.issue('journal');
		expect(counters[0]?.[1]).toBe('all');
		expect(lock).not.toHaveBeenCalled();
	});

	it('makes order numbers in each format: year-month, random groups, by year, or running', async () => {
		expect(
			await service({
				order: { kind: 'yearMonthRandom', prefix: 'ST', separator: '-', randomDigits: 6 },
			}).svc.orderNumber(undefined, AT),
		).toMatch(/^ST-2611-\d{6}$/);
		expect(
			await service({
				order: { kind: 'randomGroups', prefix: 'ST', separator: '-', groups: [5, 5] },
			}).svc.orderNumber(),
		).toMatch(/^ST-\d{5}-\d{5}$/);
		const byYear = service({ order: { kind: 'financialYearSequence', prefix: 'SO', separator: '/', digits: 5 } });
		expect(await byYear.svc.orderNumber(undefined, AT)).toBe('SO/26-27/00007');
		expect(byYear.counters).toEqual([['doc:order', '2026-27']]);
		const running = service({ order: { kind: 'runningNumber', prefix: 'SO', start: 1, digits: 5 } });
		expect(await running.svc.orderNumber()).toBe('SO00007');
		expect(running.counters).toEqual([['doc:order', 'all']]);
	});

	it('numbers an order’s parcels, returns and payment requests', async () => {
		expect(await service().svc.childNumber('parcel', 'ST-2611-482190', 2)).toBe('ST-2611-482190/P2');
	});
});
