import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Location, LocationWrite, StoreLocation, UserLocations } from '@saha-textile/contracts';
import type {
	CompanyRepository,
	GeoDataPort,
	LocationRepository,
	ShopDetailsRepository,
	StoreLocationRepository,
} from '@saha-textile/core-domain';
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
const stores = (list: Partial<StoreLocation>[]): StoreLocationRepository =>
	({ list: async () => list as StoreLocation[] }) as unknown as StoreLocationRepository;
/** The PIN directory as it really answers: 799001 (Agartala) filed under Telangana by one of its rows. */
const geo = {
	pin: async (pin: string) =>
		pin === '799001'
			? {
					pin,
					found: true,
					city: 'Nirmal',
					subdivisionCode: 'TG',
					state: 'Telangana',
					gstStateCode: '36',
					deliverable: null,
				}
			: pin === '700019'
				? {
						pin,
						found: true,
						city: 'Kolkata',
						subdivisionCode: 'WB',
						state: 'West Bengal',
						gstStateCode: '19',
						deliverable: null,
					}
				: null,
} as unknown as GeoDataPort;
const week = (opens: string, closes: string) =>
	(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((day) => ({ day, open: true, opens, closes }));
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
	it('makes the first location from Shop details and links a Stores page entry at the same PIN', async () => {
		const repo = new MemoryLocations();
		const service = new LocationsService(
			repo,
			shop,
			stores([
				{
					id: 'store_1',
					name: { en: 'Barasat' },
					address: { en: 'KB Bose Road' },
					pinCode: '700124',
					phone: '+919836663137',
					hours: week('10:00', '21:00'),
					active: true,
				},
				{
					id: 'store_2',
					name: { en: 'Gariahat' },
					address: { en: 'Rash Behari Avenue' },
					pinCode: '700019',
					phone: null,
					hours: week('10:00', '21:00'),
					active: true,
				},
				{
					id: 'store_3',
					name: { en: 'Saha Textile, Agartala' },
					address: { en: 'Colonel Chowmuhani, Krishna Nagar, Agartala, Tripura' },
					pinCode: '799001',
					phone: '+919876543210',
					hours: week('10:00', '21:00'),
					active: false,
				},
			]),
			company('19'),
			geo,
			roles,
			assignments,
		);
		const rows = await service.list(admin);
		expect(rows).toHaveLength(3);
		expect(rows.find((l) => l.pin === '700124')).toMatchObject({
			name: 'Barasat store',
			store: true,
			warehouse: true,
			storeLocationId: 'store_1',
			showOnStoresPage: true,
			gstRegistrationId: 'reg_wb',
			phone: '+919836663137',
			openingHours: 'Every day 10:00–21:00',
		});
		expect(rows.find((l) => l.pin === '700019')).toMatchObject({
			name: 'Gariahat store',
			shortCode: 'GAR',
			storeLocationId: 'store_2',
			// No State in the address: the PIN directory answers.
			stateCode: '19',
			city: 'Kolkata',
			openingHours: 'Every day 10:00–21:00',
		});
		// The address names Tripura, so the directory's wrong row (Telangana) is not used.
		expect(rows.find((l) => l.pin === '799001')).toMatchObject({
			name: 'Agartala store',
			shortCode: 'AGA',
			stateCode: '16',
			city: 'Agartala',
			phone: '+919876543210',
			showOnStoresPage: false,
		});
	});

	it('adds a location, refusing another State’s GSTIN and a taken short code', async () => {
		const service = new LocationsService(
			new MemoryLocations(),
			shop,
			stores([]),
			company('19'),
			geo,
			roles,
			assignments,
		);
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
		const service = new LocationsService(repo, shop, stores([]), company('19'), geo, roles, assignments);
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
