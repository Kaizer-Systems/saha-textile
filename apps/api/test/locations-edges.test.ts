import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AdminUserLocations, Location, LocationWrite } from '@saha-textile/contracts';
import type { CompanyRepository, LocationRepository, ShopDetailsRepository } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { LocationsService } from '../src/locations/locations.service';

class MemoryLocations implements LocationRepository {
	rows = new Map<string, Location>();
	users = new Map<string, AdminUserLocations>();
	saveError: Error | null = null;
	listCalls = 0;
	failFirstList = false;
	async list() {
		this.listCalls += 1;
		if (this.failFirstList && this.listCalls === 1) throw new Error('database down');
		return [...this.rows.values()];
	}
	async get(id: string) {
		return this.rows.get(id) ?? null;
	}
	async save(l: Location) {
		if (this.saveError) throw this.saveError;
		this.rows.set(l.id, l);
	}
	async adminUserLocations(id: string) {
		return this.users.get(id) ?? null;
	}
	async saveAdminUserLocations(v: AdminUserLocations) {
		this.users.set(v.userId, v);
	}
	async allAdminUserLocations() {
		return [...this.users.values()];
	}
}

const shopWith = (details: Record<string, unknown> | null): ShopDetailsRepository => ({
	get: async () => details as never,
	save: async () => undefined,
});
const company = {
	findRegistrationByGstin: async () => null,
	getRegistration: async (id: string) => (id === 'reg_wb' ? { id, stateCode: '19' } : null),
} as unknown as CompanyRepository;
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
	gstRegistrationId: null,
	invoiceIdentity: 'company',
	numberSeries: 'gstin',
	counterCashBox: false,
	pettyCashFloatINR: 0,
	active: true,
	expectedUpdatedAt: null,
	...patch,
});
const staff = { userId: 'usr_staff', sessionId: 's', audience: 'admin', role: 'admin', permissions: [] } as never;
const roles = { findByKey: async () => null } as never;
const assignments = { findActive: async () => null } as never;
const service = (repo = new MemoryLocations(), shop = shopWith(null)) =>
	new LocationsService(repo, shop, company, roles, assignments);

describe('locations: the remaining cases', () => {
	it('makes no first location when the shop has no GSTIN and address, and tries again after a failed start', async () => {
		const repo = new MemoryLocations();
		repo.failFirstList = true;
		const svc = service(repo, shopWith({ gstin: null, address: '' }));
		await expect(svc.list(undefined)).rejects.toThrow('database down');
		expect(await svc.list(undefined)).toEqual([]);
	});

	it('seeds a first location without a known registration', async () => {
		const repo = new MemoryLocations();
		const svc = service(
			repo,
			shopWith({
				legalName: 'X',
				tradeName: 'Y',
				gstin: '19DBYPS6736R1ZZ',
				address: 'A road',
				city: 'Barasat',
				pin: '700124',
			}),
		);
		const scope = await svc.scope(undefined);
		expect(scope.all).toBe(false);
		// Someone signed out sees no place; the seeded one is in the store.
		await svc.list(undefined);
		const rows = await repo.list();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.gstRegistrationId).toBeNull();
	});

	it('updates a location over the copy read, or the stored one, and switches it off; unknown ones are refused', async () => {
		const repo = new MemoryLocations();
		const svc = service(repo);
		const made = await svc.create(write(), 'adm');
		const renamed = await svc.update(made.id, write({ name: 'Renamed', expectedUpdatedAt: made.updatedAt }), 'adm');
		expect(renamed.name).toBe('Renamed');
		expect((await svc.update(made.id, write({ name: 'Again' }), null)).name).toBe('Again');
		expect((await svc.setActive(made.id, false, 'adm')).active).toBe(false);
		await expect(svc.update('loc_none', write(), null)).rejects.toBeInstanceOf(NotFoundException);
		await expect(svc.setActive('loc_none', true, null)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('refuses an unknown registration, and lets a save failure other than a taken code through', async () => {
		const repo = new MemoryLocations();
		const svc = service(repo);
		await expect(svc.create(write({ gstRegistrationId: 'reg_none' }), null)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		repo.saveError = new Error('database down');
		await expect(svc.create(write(), null)).rejects.toThrow('database down');
		repo.saveError = 'not an error' as never;
		await expect(svc.create(write({ shortCode: 'XYZ' }), null)).rejects.toBe('not an error');
	});

	it('checks where someone works: known places only, a home among them, the first place by default', async () => {
		const repo = new MemoryLocations();
		const svc = service(repo);
		const made = await svc.create(write(), null);
		const base = { maySwitch: false, maySeeAll: false };
		await expect(
			svc.saveAdminUserLocations('usr_staff', { ...base, worksAt: ['loc_none'], homeLocationId: null } as never),
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			svc.saveAdminUserLocations('usr_staff', {
				...base,
				worksAt: [made.id],
				homeLocationId: 'loc_other',
			} as never),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(
			(await svc.saveAdminUserLocations('usr_staff', { ...base, worksAt: [], homeLocationId: null } as never))
				.homeLocationId,
		).toBeNull();
	});

	it('refuses switching for nobody, for someone without the right, to all without “may see all”, or to a place not theirs', async () => {
		const repo = new MemoryLocations();
		const svc = service(repo);
		const made = await svc.create(write(), null);
		await expect(svc.setChip(undefined, made.id)).rejects.toBeInstanceOf(ForbiddenException);
		await svc.saveAdminUserLocations('usr_staff', {
			worksAt: [made.id],
			homeLocationId: null,
			maySwitch: false,
			maySeeAll: false,
		} as never);
		await expect(svc.setChip(staff, made.id)).rejects.toBeInstanceOf(ForbiddenException);
		await svc.saveAdminUserLocations('usr_staff', {
			worksAt: [made.id],
			homeLocationId: null,
			maySwitch: true,
			maySeeAll: false,
		} as never);
		await expect(svc.setChip(staff, null)).rejects.toBeInstanceOf(ForbiddenException);
		await expect(svc.setChip(staff, 'loc_other')).rejects.toBeInstanceOf(ForbiddenException);
		expect((await svc.setChip(staff, made.id)).current?.id).toBe(made.id);
		expect(await svc.chip(undefined)).toMatchObject({ current: null, maySwitch: false, maySeeAll: false });
	});
});
