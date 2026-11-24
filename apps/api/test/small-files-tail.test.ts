import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Order, type Location } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { AdminSecurityService } from '../src/auth/admin-security.service';
import { CommunicationsController } from '../src/communications/communications.controller';
import { CompanyController } from '../src/company/company.controller';
import { loadConfig } from '../src/config/app-config';
import { CurrencyService } from '../src/currency/currency.service';
import { GeoController } from '../src/geo/geo.controller';
import { LocationsService } from '../src/locations/locations.service';
import { OpsTokenGuard } from '../src/ops/ops-token.guard';
import { AdminPageGoLiveController } from '../src/page-builder/page-builder.controller';
import { PagePreviewService } from '../src/page-builder/page-preview.service';
import { OrderShipsFromService } from '../src/routing/order-ships-from.service';

/** An instance holding only the parts this test reads. */
const withParts = <T extends object>(type: { prototype: T }, parts: object): T =>
	Object.assign(Object.create(type.prototype), parts) as T;

const place = (id: string): Location =>
	({
		id,
		name: id,
		shortCode: id.slice(4, 7).toUpperCase(),
		active: true,
		warehouse: true,
		shipsOnline: true,
		createdAt: '2026-11-01T00:00:00.000Z',
	}) as Location;

describe('locations: the last cases', () => {
	const svc = (rows: Location[], save: () => Promise<void> = async () => undefined) =>
		new LocationsService(
			{ list: async () => rows, save, get: async () => null, allAdminUserLocations: async () => [] } as never,
			{ get: async () => null } as never,
			{ getRegistration: async () => null } as never,
			{ findByKey: async () => null } as never,
			{ findActive: async () => null } as never,
		);

	it('leaves a business that already has places as it is on the first read', async () => {
		const shop = svc([place('loc_bar')]);
		expect(await shop.list(undefined)).toEqual([]);
	});

	it('names a short code another place took while this one was saved', async () => {
		const shop = svc([], async () => {
			throw new Error('short_code_taken');
		});
		await expect(
			shop.create(
				{
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
				} as never,
				null,
			),
		).rejects.toThrow(new BadRequestException('location_problem:short_code_taken'));
	});
});

describe('settings, sign-in and operations: the last cases', () => {
	it('saves company settings with nobody named when no one is signed in, and names a new GSTIN or keeps an old one', async () => {
		const company = {
			saveProfile: vi.fn(),
			saveRegistration: vi.fn((id: string | null, _body: unknown, _canEdit: boolean, idOf: () => string) => ({
				id,
				made: idOf(),
			})),
		};
		const controller = new CompanyController(company as never);
		controller.saveProfile({ profile: {}, expectedUpdatedAt: null } as never, undefined);
		expect(company.saveProfile).toHaveBeenCalledWith({}, null, false, null);
		expect(controller.addRegistration({} as never, undefined)).toEqual({
			id: null,
			made: expect.stringMatching(/^gst_/),
		});
		expect(controller.saveRegistration('gst_1', {} as never, undefined)).toEqual({ id: 'gst_1', made: 'gst_1' });
	});

	it('checks the e-documents key and the key before it, and refuses the old key alone', () => {
		const base = { JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) };
		const key = Buffer.alloc(32, 1).toString('base64');
		const previous = Buffer.alloc(32, 2).toString('base64');
		expect(loadConfig({ ...base, EDOC_KEYS_KEY: key, EDOC_KEYS_KEY_PREVIOUS: previous }).edocs).toEqual({
			keysKey: key,
			keysKeyPrevious: previous,
		});
		expect(() => loadConfig({ ...base, EDOC_KEYS_KEY_PREVIOUS: previous })).toThrow();
	});

	it('lets an operations call through from a client with no address, and forgets old addresses past a thousand', () => {
		const guard = new OpsTokenGuard({ ops: { token: 'ops-token' } } as never);
		const call = (ip?: string) =>
			guard.canActivate({
				switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer ops-token' }, ip }) }),
			} as never);
		expect(call()).toBe(true);
		for (let index = 0; index < 1000; index += 1) call(`10.0.${Math.floor(index / 250)}.${index % 250}`);
		expect((guard as unknown as { seen: Map<string, unknown> }).seen.size).toBe(0);
	});

	it('asks for the current password for another screen’s sensitive change', async () => {
		const proof = vi.fn(async () => ({ id: 'adm_1' }));
		const security = withParts(AdminSecurityService, {
			requireRecentPasswordProof: proof,
		});
		await security.confirmCurrentPassword('adm_1', 'secret-words');
		expect(proof).toHaveBeenCalledWith('adm_1', 'secret-words');
	});

	it('passes the request’s own id with a communications switch', async () => {
		const change = vi.fn(async () => ({}));
		await new CommunicationsController({ change } as never).change(
			{ key: 'order_confirmed', channel: 'email', on: true } as never,
			{ userId: 'adm_1' } as never,
			{ id: 'req-42' } as never,
		);
		expect(change).toHaveBeenCalledWith('adm_1', expect.anything(), 'req-42');
	});
});

describe('shop data: the last cases', () => {
	it('answers "unknown country" for a code it does not know', async () => {
		await expect(new GeoController({ country: async () => null } as never).country('ZZ')).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it('shows prices with the default markup when no rates settings were saved yet', async () => {
		const currencies = new CurrencyService(
			{ listEnabled: async () => [{ code: 'USD', rateFromINR: 0.012 }] } as never,
			{ get: async () => null } as never,
		);
		const [usd] = await currencies.listForShop();
		expect(usd?.shopRateFromINR).toBeGreaterThan(0.012);
	});

	it('names an exported layout "layout" when its name has no letters it can use', async () => {
		const header = vi.fn();
		const controller = withParts(AdminPageGoLiveController, { goLive: { export: async () => ({ name: 'নতুন' }) } });
		await controller.exportLayout('lay_1', { header } as never);
		expect(header).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="layout.layout.json"');
	});

	it('keeps a bundle preview code that has not run out when the next one is made', async () => {
		const preview = new PagePreviewService(
			{} as never,
			{} as never,
			{} as never,
			{ findById: async () => ({ id: 'prd_set', type: 'bundle' }) } as never,
		);
		const now = new Date('2026-11-24T10:00:00.000Z');
		const first = await preview.bundleCode('adm_1', 'prd_set', now);
		const second = await preview.bundleCode('adm_1', 'prd_set', now);
		expect(first.code).not.toBe(second.code);
	});
});

describe('ships from: the last case', () => {
	it('records where an order shipped from as none when it was never assigned', async () => {
		const audit: Array<{ diffs: unknown[] }> = [];
		const order = Order.parse({
			id: 'ord_1',
			orderNumber: 'ST-2611-482206',
			currency: 'INR',
			status: 'placed',
			subtotalINR: 1,
			subtotalPaid: 1,
			totalINR: 1,
			totalPaid: 1,
			lines: [],
		});
		const service = new OrderShipsFromService(
			{ findById: async () => order, update: async (next: Order) => next } as never,
			{ locationStock: async () => [] } as never,
			{ list: async () => [place('loc_salt')] } as never,
			{ withTransaction: (work: (c: object) => Promise<unknown>) => work({}) } as never,
			{ append: async (entry: { diffs: unknown[] }) => void audit.push(entry) } as never,
			{ release: async () => undefined, reserve: async () => undefined } as never,
			{ get: async () => ({ mode: 'auto' }) } as never,
			{ scope: async () => ({ all: true, ids: [] }) } as never,
		);
		await service.assign('ord_1', { locationId: 'loc_salt', revision: 0, reason: '' }, undefined);
		expect(audit[0]?.diffs).toEqual([{ field: 'shipsFromLocationId', before: null, after: 'loc_salt' }]);
	});
});
