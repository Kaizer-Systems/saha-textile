import { describe, expect, it } from 'vitest';

import { ledgerClass } from '../src/ledger/ledger-rules';
import { missingRoles, resolveRole, ROLE_REGISTRY, rolesOf } from '../src/ledger/roles';

describe('roles (accounts templates T1)', () => {
	it('reads a ledger’s own roles, else the role its system key names', () => {
		expect(rolesOf({ systemKey: 'sales', roles: ['sales', 'sales_online'] })).toEqual(['sales', 'sales_online']);
		expect(rolesOf({ systemKey: 'sales', roles: [] })).toEqual(['sales']);
		expect(rolesOf({ systemKey: 'sales' })).toEqual(['sales']);
		expect(rolesOf({ systemKey: null })).toEqual([]);
	});

	it('finds the one active ledger playing a role, and refuses none or several', () => {
		const ledgers = [
			{ id: 'l1', systemKey: 'customer_advances' },
			{ id: 'l2', systemKey: null, roles: ['gateway_clearing'] },
			{ id: 'l3', systemKey: null, roles: ['gateway_clearing'], active: false },
			{ id: 'l4', systemKey: null, roles: ['rent'] },
			{ id: 'l5', systemKey: null, roles: ['rent'] },
		];
		expect(resolveRole(ledgers, 'customer_advances').id).toBe('l1');
		expect(resolveRole(ledgers, 'gateway_clearing').id).toBe('l2');
		expect(() => resolveRole(ledgers, 'sales')).toThrow('role_not_mapped:sales');
		expect(() => resolveRole(ledgers, 'rent')).toThrow('role_ambiguous:rent');
	});

	it('lists the roles a document still needs', () => {
		const chart = {
			ledgers: [
				{ id: 'a', systemKey: 'customer_advances' },
				{ id: 'b', systemKey: 'gateway_clearing', active: false },
			],
			groups: [{ id: 'g', systemKey: null, roles: ['cash_in_hand'] }],
		};
		expect(missingRoles(chart, 'refundVoucher')).toEqual(['gateway_clearing']);
		expect(missingRoles(chart, 'contra')).toEqual(['bank_accounts', 'bank_od']);
		expect(missingRoles(chart, 'nothing')).toEqual([]);
		expect(ROLE_REGISTRY.every((r) => r.neededBy.length > 0)).toBe(true);
	});

	it('tells cash from bank by the group’s role, however deep', () => {
		const groups = [
			{ id: 'g_cash', parentId: null, systemKey: null, roles: ['cash_in_hand'] },
			{ id: 'g_bank', parentId: null, systemKey: 'bank_accounts' },
			{ id: 'g_od', parentId: null, systemKey: null, roles: ['bank_od'] },
			{ id: 'g_hdfc', parentId: 'g_bank', systemKey: null },
			{ id: 'g_exp', parentId: null, systemKey: null },
		];
		expect(ledgerClass({ groupId: 'g_cash' }, groups)).toBe('cash');
		expect(ledgerClass({ groupId: 'g_hdfc' }, groups)).toBe('bank');
		expect(ledgerClass({ groupId: 'g_od' }, groups)).toBe('bank');
		expect(ledgerClass({ groupId: 'g_exp' }, groups)).toBe('other');
	});
});
