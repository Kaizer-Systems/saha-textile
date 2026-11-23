import { describe, expect, it } from 'vitest';

import { PLAYS_NO_ROLE, resolveRole, withRole, withoutRole } from '../src/ledger/roles';

/** AT4: a super admin points a role at another ledger. */
describe('pointing a role at another ledger', () => {
	it('adds the role to the new ledger and takes it off the old, which then plays nothing', () => {
		const old = { id: 'led_cash', systemKey: 'cash', roles: [] as string[] };
		const fresh = { id: 'led_till', systemKey: null, roles: [PLAYS_NO_ROLE] };
		const moved = [
			{ ...old, roles: withoutRole(old, 'cash') },
			{ ...fresh, roles: withRole(fresh, 'cash') },
		];
		expect(moved.map((l) => l.roles)).toEqual([[PLAYS_NO_ROLE], ['cash']]);
		expect(resolveRole(moved, 'cash').id).toBe('led_till');
		expect(withoutRole({ systemKey: null, roles: ['cash', 'bank_charges'] }, 'cash')).toEqual(['bank_charges']);
		expect(withRole({ systemKey: 'cash', roles: [] }, 'cash')).toEqual(['cash']);
	});
});
