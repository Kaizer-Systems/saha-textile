import type { PayrollRulesVersion } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { BUILT_IN_PAYROLL_RULES, rulesOf } from '../src/payroll/payroll-rules.service';

/**
 * Brief 26 BN2, BN-D2, BN-D3 in the rules split: the bonus law and wage basis by the version's date, and the wage
 * heads and the PF switch carried to the month's pay rules only when the version sets them.
 */
const version = (over: Partial<PayrollRulesVersion>) => ({ ...BUILT_IN_PAYROLL_RULES, ...over }) as PayrollRulesVersion;

describe('bonus law and wages by the version (BN-D2)', () => {
	it('reads a version without its own law under the Code from 21 Nov 2025, and the Act before', () => {
		const bare = { ...BUILT_IN_PAYROLL_RULES.bonus, law: undefined, wageBasis: undefined } as never;
		expect(rulesOf(version({ from: '2025-12-01', bonus: bare })).bonus).toMatchObject({
			law: 'code_on_wages',
			wageBasis: 'code',
		});
		expect(rulesOf(version({ from: '2025-06-01', bonus: bare })).bonus).toMatchObject({
			law: 'bonus_act',
			wageBasis: 'basic_da',
		});
	});
});

describe('the heads counted as wages and PF on them (BN-D3)', () => {
	it('carries them to the pay rules only when the version sets them', () => {
		const set = rulesOf(version({ wageHeads: ['basic', 'da', 'special'], pfUsesCodeWages: true })).pay;
		expect(set).toMatchObject({ wageHeads: ['basic', 'da', 'special'], pfUsesCodeWages: true });
		const plain = rulesOf(version({ wageHeads: undefined, pfUsesCodeWages: false })).pay;
		expect('wageHeads' in plain).toBe(false);
		expect('pfUsesCodeWages' in plain).toBe(false);
	});
});
