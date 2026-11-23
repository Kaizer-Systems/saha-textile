import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Location, LocationWrite, UserLocations } from '@saha-textile/contracts';
import type { CompanyRepository, LocationRepository, ShopDetailsRepository } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { LocationsService } from '../src/locations/locations.service';

class MemoryLocations implements LocationRepository {
	rows = new Map<string, Location>();
	users = new Map<string, UserLocations>();
	async list() {
		return [...this.rows.values()];
	}
	async get(id: string) {
		return this.rows.get(id) ?? null;
	}
	async save(l: Location, expected: string | null) {
		if (expected === null && [...this.rows.values()].some((r) => r.shortCode === l.shortCode))
			throw new Error('short_code_taken');
		this.rows.set(l.id, l);
	}
	async userLocations(id: string) {
		return this.users.get(id) ?? null;
	}
	async saveUserLocations(v: UserLocations) {
		this.users.set(v.userId, v);
	}
	async allUserLocations() {
		return [...this.users.values()];
	}
}

const shop: ShopDetailsRepository = {
	get: async () =>
		({
			legalName: 'Example Proprietor',
			tradeName: 'K.R. Marketing',
			gstin: '19DBYPS6736R1ZZ',
			address: '11/1A, K.B. Bose Road',
			city: 'Barasat',
			pin: '700124',
		}) as never,
	save: async () => undefined,
};
const company = (regState: string | null): CompanyRepository =>
	({
		findRegistrationByGstin: async () => (regState ? { id: 'reg_wb', stateCode: regState } : null),
		getRegistration: async (id: string) =>
			id === 'reg_wb' ? { id, stateCode: '19' } : id === 'reg_tr' ? { id, stateCode: '16' } : null,
	}) as unknown as CompanyRepository;

const write = (patch: Partial<LocationWrite> = {}): LocationWrite => ({
	name: 'Sreerampore warehouse',
	shortCode: 'SRP',
	warehouse: true,
	store: false,
	office: false,
	courierPickup: false,
	shipsOnline: false,
	showOnStoresPage: false,
	storeLocationId: null,
	address: 'Simla, Sreerampore',
	pin: '712203',
	city: 'Sreerampore',
	stateCode: '19',
	phone: '',
	openingHours: '',
	shopsEstablishmentNo: '',
	gstRegistrationId: 'reg_wb',
	invoiceIdentity: 'company',
	numberSeries: 'gstin',
	counterCashBox: false,
	pettyCashFloatINR: 0,
	active: true,
	expectedUpdatedAt: null,
	...patch,
});
const admin = { userId: 'usr_owner', sessionId: 's', audience: 'admin', role: 'admin', permissions: [] } as never;
// A store manager has the coarse `admin` role too; only the Administrator role makes a super admin.
const staff = { userId: 'usr_staff', sessionId: 's', audience: 'admin', role: 'admin', permissions: [] } as never;
const roles = { findByKey: async (key: string) => (key === 'administrator' ? { id: 'role_admin' } : null) } as never;
const assignments = {
	findActive: async (userId: string, roleId: string) =>
		userId === 'usr_owner' && roleId === 'role_admin' ? { userId, roleId } : null,
} as never;

describe('locations (accounts brief K, L)', () => {
	it('makes only the business’s own place; Stores page entries (another company) never become locations', async () => {
		const service = new LocationsService(new MemoryLocations(), shop, company('19'), roles, assignments);
		const rows = await service.list(admin);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			name: 'Barasat warehouse',
			shortCode: 'BAR',
			warehouse: true,
			store: false,
			shipsOnline: true,
			storeLocationId: null,
			showOnStoresPage: false,
			phone: '',
			openingHours: '',
			gstRegistrationId: 'reg_wb',
		});
	});

	it('adds a location, refusing another State’s GSTIN and a taken short code', async () => {
		const service = new LocationsService(new MemoryLocations(), shop, company('19'), roles, assignments);
		await service.list(admin);
		const made = await service.create(write(), 'usr_owner');
		expect(made).toMatchObject({ shortCode: 'SRP', warehouse: true });
		await expect(service.create(write({ shortCode: 'SRP' }), null)).rejects.toThrow(
			'location_problem:short_code_taken',
		);
		await expect(
			service.create(write({ shortCode: 'AGT', gstRegistrationId: 'reg_tr' }), null),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('shows staff only where they work, with a fixed chip; owners may pick all', async () => {
		const repo = new MemoryLocations();
		const service = new LocationsService(repo, shop, company('19'), roles, assignments);
		const [first] = await service.list(admin);
		const second = await service.create(write(), null);
		await service.saveUserLocations('usr_staff', {
			worksAt: [second.id],
			homeLocationId: null,
			maySwitch: false,
			maySeeAll: false,
		});
		expect((await service.list(staff)).map((l) => l.id)).toEqual([second.id]);
		const chip = await service.chip(staff);
		expect(chip).toMatchObject({ current: { id: second.id }, maySwitch: false, maySeeAll: false });
		await expect(service.setChip(staff, first!.id)).rejects.toBeInstanceOf(ForbiddenException);
		expect((await service.chip(admin)).allLocations).toBe(true);
		expect((await service.setChip(admin, second.id)).current?.id).toBe(second.id);
		expect((await service.setChip(admin, null)).allLocations).toBe(true);
	});
});
