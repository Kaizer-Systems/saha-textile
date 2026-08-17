import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import type { Address, Customer } from '@saha-textile/contracts';

import { AUDIENCE_KEY } from '../src/auth/session.guard';
import { StorefrontAddressesController } from '../src/storefront/storefront-addresses.controller';
import { StorefrontProfileController } from '../src/storefront/storefront-profile.controller';

/**
 * The customer's own account routes.
 *
 * These were verified in a browser only, which exercises exactly one path: the owner acting on
 * their own data. The interesting cases are the ones a browser cannot easily be made to do —
 * naming somebody else's address id, naming one that does not exist, and putting a login
 * credential in a profile patch.
 *
 * The ownership claim in `storefront-addresses.controller.ts` is that it is STRUCTURAL: no route
 * carries a customer id, so a caller cannot name another account. A test that only checked "a
 * cross-account request is refused" would pass just as well against a version that took a
 * `:customerId` and guarded it — and would keep passing on the day somebody removed the guard
 * from the fourth route. So the shape is asserted directly, alongside the behaviour.
 *
 * The repository fake mirrors the real Mongo one where it matters: address writes are scoped by
 * customer id AND address id together, and answer `null` when nothing matched. That `null` is the
 * whole subject of the delete case below — `$pull` alone reported success either way, so the route
 * answered 200 for an address that never existed, including one belonging to another account.
 */

const OWNER = 'cus_owner';
const STRANGER = 'cus_stranger';

const principal = (userId: string) => ({ userId, sessionId: `sess_${userId}`, audience: 'storefront' }) as never;

function address(id: string, over: Partial<Address> = {}): Address {
	return {
		id,
		fullName: 'Ada Lovelace',
		line1: '12 Analytical Way',
		city: 'Kolkata',
		postalCode: '700001',
		country: 'India',
		isDefault: false,
		...over,
	};
}

function customer(id: string, addresses: Address[]): Customer {
	return {
		id,
		email: `${id}@example.test`,
		emailVerified: true,
		phone: null,
		phoneVerified: false,
		displayName: 'Ada',
		status: 'active',
		addresses,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	} as Customer;
}

type Harness = {
	addresses: StorefrontAddressesController;
	profile: StorefrontProfileController;
	/** Every customer id the repository was actually asked about. */
	touched: string[];
	rows: Map<string, Customer>;
	patches: Array<Record<string, unknown>>;
};

function harness(): Harness {
	const rows = new Map<string, Customer>([
		[OWNER, customer(OWNER, [address('adr_owner_1'), address('adr_owner_2')])],
		[STRANGER, customer(STRANGER, [address('adr_stranger_1')])],
	]);
	const result: Partial<Harness> = { touched: [], rows, patches: [] };

	/** Scoped exactly like the Mongo repository: no match on BOTH ids means no row and no write. */
	const locate = (customerId: string, addressId: string) => {
		result.touched?.push(customerId);
		const row = rows.get(customerId);
		const index = row?.addresses.findIndex((entry) => entry.id === addressId) ?? -1;
		return index < 0 ? null : { row: row as Customer, index };
	};

	const customers = {
		findById: async (id: string) => {
			result.touched?.push(id);
			return rows.get(id) ?? null;
		},
		update: async (id: string, patch: Record<string, unknown>) => {
			result.touched?.push(id);
			result.patches?.push(patch);
			const row = rows.get(id);
			if (!row) return null;
			const next = { ...row, ...patch } as Customer;
			rows.set(id, next);
			return next;
		},
		addAddress: async (id: string, entry: Address) => {
			result.touched?.push(id);
			const row = rows.get(id);
			if (!row) return null;
			const next = { ...row, addresses: [...row.addresses, entry] };
			rows.set(id, next);
			return next;
		},
		updateAddress: async (id: string, addressId: string, patch: Partial<Omit<Address, 'id'>>) => {
			const found = locate(id, addressId);
			if (!found) return null;
			const addresses = [...found.row.addresses];
			addresses[found.index] = { ...addresses[found.index], ...patch, id: addressId } as Address;
			const next = { ...found.row, addresses };
			rows.set(id, next);
			return next;
		},
		deleteAddress: async (id: string, addressId: string) => {
			const found = locate(id, addressId);
			if (!found) return null;
			const next = { ...found.row, addresses: found.row.addresses.filter((e) => e.id !== addressId) };
			rows.set(id, next);
			return next;
		},
	};

	result.addresses = new StorefrontAddressesController(customers as never);
	result.profile = new StorefrontProfileController(customers as never);
	return result as Harness;
}

describe('ownership is structural', () => {
	/**
	 * The property the whole design rests on. If a customer id ever appears in one of these
	 * paths, the guarantee stops being "cannot be expressed" and becomes "is checked somewhere",
	 * which is the arrangement this controller exists to avoid.
	 */
	it('declares no customer id in any route path', () => {
		const paths = [
			Reflect.getMetadata(PATH_METADATA, StorefrontAddressesController),
			Reflect.getMetadata(PATH_METADATA, StorefrontProfileController),
			...(['list', 'add', 'update', 'remove'] as const).map((method) =>
				Reflect.getMetadata(PATH_METADATA, StorefrontAddressesController.prototype[method]),
			),
			Reflect.getMetadata(PATH_METADATA, StorefrontProfileController.prototype.update),
		];

		expect(paths.length).toBeGreaterThan(0);
		for (const path of paths) {
			expect(String(path).toLowerCase()).not.toContain('customer');
		}
	});

	it('closes the other direction — an operator session cannot use the customer doorway', () => {
		expect(Reflect.getMetadata(AUDIENCE_KEY, StorefrontAddressesController)).toBe('storefront');
		expect(Reflect.getMetadata(AUDIENCE_KEY, StorefrontProfileController)).toBe('storefront');
	});

	it('reads the owner from the session, never from the request', async () => {
		const h = harness();
		await h.addresses.list(principal(OWNER));
		await h.addresses.add(address('ignored') as never, principal(OWNER));

		expect(h.touched).not.toContain(STRANGER);
		expect(new Set(h.touched)).toEqual(new Set([OWNER]));
	});

	it.each([
		['list', (h: Harness) => h.addresses.list(undefined)],
		['add', (h: Harness) => h.addresses.add(address('x') as never, undefined)],
		['update', (h: Harness) => h.addresses.update('adr_owner_1', {}, undefined)],
		['remove', (h: Harness) => h.addresses.remove('adr_owner_1', undefined)],
		['profile', (h: Harness) => h.profile.update({ displayName: 'Ada' }, undefined)],
	] as const)('%s refuses an unauthenticated caller', async (_name, call) => {
		await expect(call(harness())).rejects.toThrow(/Authentication required/);
	});
});

describe("another customer's address", () => {
	it('cannot be patched, and is left untouched', async () => {
		const h = harness();

		await expect(h.addresses.update('adr_stranger_1', { city: 'Delhi' }, principal(OWNER))).rejects.toThrow(
			/Address not found/,
		);
		expect(h.rows.get(STRANGER)?.addresses[0]?.city).toBe('Kolkata');
	});

	it('cannot be deleted, and is left untouched', async () => {
		const h = harness();

		await expect(h.addresses.remove('adr_stranger_1', principal(OWNER))).rejects.toThrow(/Address not found/);
		expect(h.rows.get(STRANGER)?.addresses).toHaveLength(1);
	});

	/**
	 * The refusal must not be a different refusal from "no such address". Distinguishing the two
	 * would answer, for any id an attacker holds, whether it belongs to somebody.
	 */
	it('is refused exactly as an id that never existed is refused', async () => {
		const h = harness();
		const stranger = await h.addresses.remove('adr_stranger_1', principal(OWNER)).catch((e: Error) => e.message);
		const fiction = await h.addresses.remove('adr_nonexistent', principal(OWNER)).catch((e: Error) => e.message);

		expect(stranger).toBe(fiction);
	});
});

describe('addresses', () => {
	it('lists only the caller’s own', async () => {
		const h = harness();
		const { addresses } = await h.addresses.list(principal(OWNER));

		expect(addresses.map((a) => a.id)).toEqual(['adr_owner_1', 'adr_owner_2']);
	});

	it('assigns the id server-side rather than taking one from the body', async () => {
		const h = harness();
		// The contract omits `id`, so a body claiming one is discarded before it reaches here.
		const updated = await h.addresses.add(address('adr_attacker_choice') as never, principal(OWNER));
		const added = updated.addresses.at(-1) as Address;

		expect(added.id).not.toBe('adr_attacker_choice');
		expect(added.id).toMatch(/^adr_/);
	});

	it('patches one of the caller’s own', async () => {
		const h = harness();
		const updated = await h.addresses.update('adr_owner_1', { city: 'Delhi' }, principal(OWNER));

		expect(updated.addresses[0]?.city).toBe('Delhi');
	});

	/**
	 * The regression this route was carrying: `$pull` reports success whether or not it removed
	 * anything, so a delete of an id that never existed answered 200 with an unchanged account.
	 */
	it('refuses to report success for an id that never existed', async () => {
		const h = harness();

		await expect(h.addresses.remove('adr_nonexistent', principal(OWNER))).rejects.toThrow(/Address not found/);
		expect(h.rows.get(OWNER)?.addresses).toHaveLength(2);
	});

	it('removes one of the caller’s own', async () => {
		const h = harness();
		const updated = await h.addresses.remove('adr_owner_1', principal(OWNER));

		expect(updated.addresses.map((a) => a.id)).toEqual(['adr_owner_2']);
	});
});

describe('profile', () => {
	it('changes the display name', async () => {
		const h = harness();
		const updated = await h.profile.update({ displayName: '  Ada Lovelace  ' }, principal(OWNER));

		expect(updated.displayName).toBe('Ada Lovelace');
	});

	/**
	 * The point of the narrow body. Email and phone are login credentials; letting either through
	 * would hand a stolen session the account's recovery channel in one request. The contract
	 * strips them, and this pins that the repository is never asked to write them.
	 */
	it('writes the display name and nothing else, even when a credential is offered', async () => {
		const h = harness();
		await h.profile.update(
			{ displayName: 'Ada', email: 'attacker@example.test', phone: '+919900000000' } as never,
			principal(OWNER),
		);

		expect(h.patches).toEqual([{ displayName: 'Ada' }]);
	});
});
