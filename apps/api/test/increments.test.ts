import { BadRequestException } from '@nestjs/common';
import { IncrementPlanWrite, IncrementRowsInput } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { IncrementsController, IncrementsService } from '../src/payroll/increments';

/** Brief 26 SR3: plans saved by name, a cycle's rows worked out, and Accept keeping each row's refusal on it. */
const at = '2026-11-26T06:00:00.000Z';
const side = (ctcMonthINR: number) => ({ ctcMonthINR });
const checks = [{ code: 'below_minimum_wage' as const, blocking: false, inr: 500 }];

function build() {
	const stored = new Map<string, unknown>();
	const plans = {
		list: vi.fn(async () => [...stored.values()]),
		save: vi.fn(async (p: { id: string }) => {
			stored.set(p.id, p);
			return p;
		}),
		delete: vi.fn(async (id: string) => void stored.delete(id)),
	};
	const revisions = {
		preview: vi.fn(async (id: string) => ({
			now: side(30_000),
			next: side(id === 'emp_amit' ? 30_750 : 32_400),
			changePct: id === 'emp_amit' ? 2.5 : 8,
			checks: id === 'emp_amit' ? checks : [],
		})),
		accept: vi.fn(async (id: string) => {
			if (id === 'emp_rina') throw new BadRequestException({ message: 'revision_decrease_needs_agreement' });
			if (id === 'emp_down') throw new Error('disk full');
			return {};
		}),
	};
	return { service: new IncrementsService(plans as never, revisions as never), plans, revisions };
}
const rows = (ids: string[]) =>
	IncrementRowsInput.parse({
		from: '2027-04-01',
		reason: 'April 2027 cycle',
		rows: ids.map((employeeId) => ({ employeeId, way: { kind: 'percent', pct: 8 }, rating: 'A' })),
	});

describe('increment plans (SR3)', () => {
	it('keeps a plan by its name: the same name again replaces it, whatever its case', async () => {
		const { service } = build();
		const write = IncrementPlanWrite.parse({
			name: 'Store staff 2027',
			kind: 'rating',
			bands: [
				{ rating: 'A+', pct: 12 },
				{ rating: 'A', pct: 8 },
			],
		});
		const first = await service.savePlan(write, new Date(at));
		const again = await service.savePlan({ ...write, name: ' store staff 2027 ' }, new Date(at));
		expect(again.id).toBe(first.id);
		expect(first).toMatchObject({ id: expect.stringMatching(/^inc_[0-9a-f]{16}$/), updatedAt: at });
		expect(await service.plansList()).toHaveLength(1);
		await service.deletePlan(first.id);
		expect(await service.plansList()).toEqual([]);
	});
});

describe('a cycle (SR3)', () => {
	it('works out each row as SR2 does: the CTC a year now and new, the change a month, the checks', async () => {
		const { service, revisions } = build();
		expect(await service.preview(rows(['emp_priya', 'emp_amit']))).toEqual([
			{
				employeeId: 'emp_priya',
				ctcYearNowINR: 360_000,
				ctcYearNewINR: 388_800,
				changeMonthINR: 2_400,
				changePct: 8,
				checks: [],
			},
			{
				employeeId: 'emp_amit',
				ctcYearNowINR: 360_000,
				ctcYearNewINR: 369_000,
				changeMonthINR: 750,
				changePct: 2.5,
				checks,
			},
		]);
		expect(revisions.preview).toHaveBeenCalledWith('emp_priya', {
			way: { kind: 'percent', pct: 8 },
			from: '2027-04-01',
			templateId: null,
			typed: {},
			lockCtc: true,
			reason: 'April 2027 cycle',
			agreed: false,
		});
	});

	it('accepts each row, keeping a refusal or a failure on its row and going on', async () => {
		const { service } = build();
		expect(await service.accept(rows(['emp_priya', 'emp_rina', 'emp_down']), undefined)).toEqual([
			{ employeeId: 'emp_priya', ok: true, problem: null },
			{ employeeId: 'emp_rina', ok: false, problem: 'revision_decrease_needs_agreement' },
			{ employeeId: 'emp_down', ok: false, problem: 'failed' },
		]);
	});

	it('hands each route to the service', () => {
		const svc = { plansList: vi.fn(), savePlan: vi.fn(), deletePlan: vi.fn(), preview: vi.fn(), accept: vi.fn() };
		const c = new IncrementsController(svc as never);
		const body = rows(['emp_priya']);
		c.plans();
		c.savePlan({ name: 'x' } as never);
		c.deletePlan('inc_1');
		c.preview(body);
		c.accept(body, { userId: 'adm_acc' } as never);
		expect(svc.deletePlan).toHaveBeenCalledWith('inc_1');
		expect(svc.accept).toHaveBeenCalledWith(body, { userId: 'adm_acc' });
		expect([svc.plansList, svc.savePlan, svc.preview].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
	});
});
