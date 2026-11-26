import { describe, expect, it } from 'vitest';

import { missingRoles, ROLE_REGISTRY } from '../src/ledger/roles';

/** An expense bill posts to input tax and the supplier's account (brief 25 EB1, EB2): the roles it needs mapped. */

const holder = (key: string, active = true) => ({ id: `led_${key}`, systemKey: key, roles: [] as string[], active });

describe('the roles an expense bill needs', () => {
	it('needs the three input tax ledgers and the creditors control, and nothing else', () => {
		expect(ROLE_REGISTRY.filter((role) => role.neededBy.includes('expenseBill')).map((role) => role.key)).toEqual([
			'input_cgst',
			'input_sgst',
			'input_igst',
			'creditors_control',
		]);
		expect(missingRoles({ ledgers: [], groups: [] }, 'expenseBill')).toEqual([
			'input_cgst',
			'input_sgst',
			'input_igst',
			'creditors_control',
		]);
	});

	it('wants none once each is played by an active ledger, and an inactive one still missing', () => {
		const ledgers = ['input_cgst', 'input_sgst', 'input_igst', 'creditors_control'].map((key) => holder(key));
		expect(missingRoles({ ledgers, groups: [] }, 'expenseBill')).toEqual([]);
		const closed = ledgers.map((l) => (l.systemKey === 'input_igst' ? { ...l, active: false } : l));
		expect(missingRoles({ ledgers: closed, groups: [] }, 'expenseBill')).toEqual(['input_igst']);
	});

	it('keeps the purchase bill’s needs as they were beside it', () => {
		const forPurchase = ROLE_REGISTRY.filter((role) => role.neededBy.includes('purchaseEntry')).map(
			(role) => role.key,
		);
		expect(forPurchase).toEqual(
			expect.arrayContaining(['input_cgst', 'input_sgst', 'input_igst', 'creditors_control']),
		);
		expect(ROLE_REGISTRY.find((role) => role.key === 'input_igst')?.neededBy).not.toContain('inputTaxReversal');
	});
});
