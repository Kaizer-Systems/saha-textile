import { describe, expect, it, vi } from 'vitest';

import { BUILT_IN_PAYROLL_RULES, rulesOf } from '../src/payroll/payroll-rules.service';
import { PayrollSetupController } from '../src/payroll/payroll-setup.controller';
import { SalaryTemplatesService } from '../src/payroll/salary-templates.service';

/** Brief 26 SR1: a structure built from the yearly CTC, the employer's share inside it, shown on an example. */
const STORE_STAFF = [
	{ head: 'basic' as const, how: 'percent' as const, value: 45 },
	{ head: 'da' as const, how: 'percent_basic' as const, value: 10 },
	{ head: 'hra' as const, how: 'percent_basic' as const, value: 40 },
	{ head: 'conveyance' as const, how: 'fixed' as const, value: 1_600 },
	{ head: 'special' as const, how: 'rest' as const, value: 0 },
];
const service = () =>
	new SalaryTemplatesService({} as never, { forMonth: async () => rulesOf(BUILT_IN_PAYROLL_RULES) } as never);

describe('a structure from the CTC (SR1)', () => {
	it('splits ₹3,60,000 a year: Basic on the CTC, DA and rent on Basic, the rest after PF and gratuity', async () => {
		const p = await service().previewCtc(STORE_STAFF, 360_000, new Date('2026-11-26T06:00:00Z'));
		expect(p.structure).toEqual({
			basic: 13_500,
			da: 1_350,
			hra: 5_400,
			conveyance: 1_600,
			special: 5_654,
			other: 0,
		});
		// PF ₹1,782 on Basic and DA under the ceiling, gratuity ₹714 on them: the CTC stays ₹30,000.
		expect([p.employerINR, p.ctcMonthINR, p.fits, p.totalINR]).toEqual([1_782 + 714, 30_000, true, 27_504]);
	});

	it('says when the other heads take more than the CTC', async () => {
		const p = await service().previewCtc(
			[...STORE_STAFF.slice(0, 4), { head: 'other', how: 'fixed', value: 50_000 }, ...STORE_STAFF.slice(4, 5)],
			360_000,
		);
		expect(p.fits).toBe(false);
	});

	it('is chosen by the route when asked for a CTC, the monthly pay otherwise', async () => {
		const templates = { preview: vi.fn(), previewCtc: vi.fn() };
		const c = new PayrollSetupController({} as never, templates as never, {} as never, {} as never);
		c.preview({ components: STORE_STAFF, payINR: 360_000, ctc: true });
		c.preview({ components: STORE_STAFF, payINR: 20_000, ctc: false });
		expect(templates.previewCtc).toHaveBeenCalledWith(STORE_STAFF, 360_000);
		expect(templates.preview).toHaveBeenCalledWith(STORE_STAFF, 20_000);
	});
});
