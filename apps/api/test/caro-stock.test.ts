import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { CaroStockController, CaroStockService } from '../src/reports/caro-stock';
import { ReportsModule } from '../src/reports/reports.module';

/** CARO 2020 3(ii)(a) (accounts brief R1): stock counts posted in a period, each class against the 10% line. */

const line = (
	soldBy: 'piece' | 'metre',
	expected: number | null,
	counted: number | null,
	valueINR: number | null = null,
) => ({
	soldBy,
	expected,
	counted,
	valueINR,
});
const count = (id: string, postedAt: string | null, lines: unknown[] = []) => ({
	id,
	number: `SC/${id}`,
	label: `Count ${id}`,
	postedAt,
	lines,
});
/** Sarees 15% short (reportable), fabric 2% short (not). */
const MARCH = count('march', '2027-03-31T12:00:00.000Z', [
	line('piece', 60, 50, -4_000),
	line('piece', 40, 35, -2_000),
	line('metre', 50, 49, -150.5),
	line('piece', null, 3),
]);
/** Two pieces found where the books had none: reportable, though no percent can be worked out. */
const APRIL = count('april', '2026-04-01T06:00:00.000Z', [line('piece', 0, 2)]);

function build(pages: unknown[][]) {
	const counts = { list: vi.fn(async (query: { page: number }) => ({ items: pages[query.page - 1] ?? [] })) };
	return { service: new CaroStockService(counts as never), counts };
}

describe('the CARO stock verification report (R1)', () => {
	it('reads every posted count, page by page, and keeps those posted in the period, each class against 10%', async () => {
		const outside = Array.from({ length: 197 }, (_, i) => count(`old${i}`, '2026-03-31T18:00:00.000Z'));
		const { service, counts } = build([
			[APRIL, count('unposted', null), count('later', '2027-04-01T00:00:00.000Z'), ...outside],
			[MARCH],
		]);
		const report = await service.report({ from: '2026-04-01', to: '2027-03-31', locationId: null });
		expect(counts.list.mock.calls.map(([q]) => q)).toEqual([
			{ filter: 'posted', page: 1, pageSize: 200 },
			{ filter: 'posted', page: 2, pageSize: 200 },
		]);
		expect(report.from).toBe('2026-04-01');
		expect(report.to).toBe('2027-03-31');
		expect(report.counts.map((c) => [c.id, c.number, c.label, c.postedAt])).toEqual([
			['april', 'SC/april', 'Count april', '2026-04-01T06:00:00.000Z'],
			['march', 'SC/march', 'Count march', '2027-03-31T12:00:00.000Z'],
		]);
		expect(report.counts[0]?.classes).toEqual([
			{
				soldBy: 'piece',
				bookQty: 0,
				countedQty: 2,
				differenceQty: 2,
				percent: null,
				differenceINR: 0,
				reportable: true,
			},
		]);
		expect(report.counts[1]?.classes).toEqual([
			{
				soldBy: 'piece',
				bookQty: 100,
				countedQty: 85,
				differenceQty: -15,
				percent: 15,
				differenceINR: -6_000,
				reportable: true,
			},
			{
				soldBy: 'metre',
				bookQty: 50,
				countedQty: 49,
				differenceQty: -1,
				percent: 2,
				differenceINR: -150.5,
				reportable: false,
			},
		]);
		expect(report.reportable).toBe(2);
	});

	it('reports nothing when no count was posted', async () => {
		expect(await build([[]]).service.report({ from: '2026-04-01', to: '2027-03-31', locationId: null })).toEqual({
			from: '2026-04-01',
			to: '2027-03-31',
			locationId: null,
			counts: [],
			reportable: 0,
		});
	});

	it('answers on the reports route with accounts.index', async () => {
		const caro = { report: vi.fn(async () => 'report') };
		const period = { from: '2026-04-01', to: '2027-03-31', locationId: null };
		expect(await new CaroStockController(caro as never).report(period)).toBe('report');
		expect(caro.report).toHaveBeenCalledWith(period);
		expect(new Reflector().get(PERMISSIONS_KEY, CaroStockController.prototype.report)).toEqual(['accounts.index']);
		expect(Reflect.getMetadata('controllers', ReportsModule)).toContain(CaroStockController);
		expect(Reflect.getMetadata('providers', ReportsModule)).toContain(CaroStockService);
	});
});
