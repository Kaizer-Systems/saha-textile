import { HttpClient } from '@angular/common/http';
import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { AdminUserLocationsCard } from '@features/user/user-locations/user-locations';

import { LocationFormPage } from './locations/location-form';
import { LocationsListPage } from './locations/locations-list';
import { OrderRoutingPage } from './order-routing/order-routing';

/** Queries read `h.data` by their key joined with "/"; `h.bump()` makes the pages read again. */
const h = vi.hoisted(() => ({
	data: new Map<string, unknown>(),
	bump: (): void => undefined,
	options: [] as Array<() => { queryKey: unknown[]; queryFn: () => unknown; enabled?: boolean }>,
}));
vi.mock('@tanstack/angular-query-experimental', async (original) => {
	const actual = await original<typeof import('@tanstack/angular-query-experimental')>();
	const { computed, signal } = await import('@angular/core');
	const version = signal(0);
	h.bump = () => version.update((value) => value + 1);
	return {
		...actual,
		injectQuery: (options: (typeof h.options)[number]) => {
			h.options.push(options);
			return {
				data: computed(() => {
					version();
					return h.data.get(options().queryKey.join('/'));
				}),
			};
		},
	};
});
const put = (key: readonly unknown[], value: unknown) => {
	h.data.set(key.join('/'), value);
	h.bump();
};

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

const gateway = {
	list: vi.fn(() => of([])),
	create: vi.fn((_body: unknown) => of({})),
	save: vi.fn((_id: string, _body: unknown) => of({})),
	setActive: vi.fn((_id: string, _on: boolean) => of({})),
	adminUserLocations: vi.fn(() => of({})),
	saveAdminUserLocations: vi.fn((_id: string, _body: unknown) => of({})),
};
const company = { registrations: vi.fn(() => of([])) };
const http = { get: vi.fn(() => of({})), put: vi.fn((_url: string, _body: unknown) => of({})) };
const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
const router = { navigate: vi.fn(async () => true) };
const queryClient = { invalidateQueries: vi.fn(async () => undefined) };

function make<T>(type: Type<T>, params: Record<string, string> = {}, permissions = ['setting.edit', 'location.edit']) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: LocationsGateway, useValue: gateway },
			{ provide: CompanyGateway, useValue: company },
			{ provide: HttpClient, useValue: http },
			{ provide: NotificationService, useValue: notifier },
			{ provide: Router, useValue: router },
			{ provide: QueryClient, useValue: queryClient },
			{ provide: TranslocoService, useValue: { translate: t } },
			{ provide: AuthStore, useValue: { permissions: () => permissions } },
			{ provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap(params)) } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	return { c: fixture.componentInstance, fixture };
}

const location = (over: Record<string, unknown> = {}) => ({
	id: 'loc_1',
	name: 'College Street shop',
	active: true,
	stateCode: '19',
	gstRegistrationId: 'reg_1',
	store: true,
	warehouse: true,
	office: false,
	pettyCashFloatINR: 500,
	createdAt: 'x',
	updatedAt: '2026-11-23T00:00:00.000Z',
	updatedBy: 'adm_1',
	people: 3,
	...over,
});

afterEach(() => {
	vi.clearAllMocks();
	h.data.clear();
});

describe('Settings › Order routing', () => {
	it('fills the form from the saved settings and saves the split limit as a number', async () => {
		const empty = make(OrderRoutingPage);
		await empty.c.save();
		expect(http.put).not.toHaveBeenCalled();
		put(['settings', 'order-routing'], {
			mode: 'suggest',
			splitLimitINR: 5000,
			updatedAt: 'u1',
			updatedBy: 'adm_1',
		});
		const { c, fixture } = make(OrderRoutingPage);
		fixture.detectChanges();
		expect(c.form()).toEqual({ mode: 'suggest', splitLimitINR: 5000, expectedUpdatedAt: 'u1' });
		c.set('splitLimitINR', '' as never);
		await c.save();
		expect(http.put).toHaveBeenCalledWith(
			expect.stringContaining('/admin/settings/order-routing'),
			expect.objectContaining({ splitLimitINR: 0 }),
		);
		expect(notifier.showSuccess).toHaveBeenCalledWith('routing_saved');
		http.put.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.save();
		expect(notifier.showError).toHaveBeenCalledWith('routing_save_failed');
		expect(c.saving()).toBe(false);
		const reader = make(OrderRoutingPage, {}, []);
		await reader.c.save();
		expect(http.put).toHaveBeenCalledTimes(2);
		empty.c.set('mode', 'auto' as never);
		expect(empty.c.form()).toBeNull();
		for (const options of h.options) await options().queryFn();
	});
});

describe('Settings › Locations', () => {
	it('lists locations with their State and GSTIN', async () => {
		put(COMPANY_KEYS.registrations, [{ id: 'reg_1', gstin: '19AAPFS4821K1Z5', stateCode: '19' }]);
		const { c } = make(LocationsListPage);
		expect(c.stateName('19')).toBe('West Bengal');
		expect(c.stateName('XX')).toBe('XX');
		expect(c.gstinOf('reg_1')).toBe('19AAPFS4821K1Z5');
		expect(c.gstinOf('reg_9')).toBe('—');
		expect(c.gstinOf(null)).toBe('—');
		expect(c.canEdit()).toBe(true);
		for (const options of h.options) await options().queryFn();
		expect(company.registrations).toHaveBeenCalled();
	});

	it('starts a new location, keeps the store, warehouse and office rules, and creates it', async () => {
		put(COMPANY_KEYS.registrations, [
			{ id: 'reg_1', stateCode: '19' },
			{ id: 'reg_2', stateCode: '27' },
		]);
		const { c } = make(LocationFormPage, { id: 'new' });
		expect(c.isNew()).toBe(true);
		expect(c.current()).toBeNull();
		c.set('store', true as never);
		expect(c.form()).toMatchObject({ store: true, warehouse: true, office: false });
		c.set('warehouse', false as never);
		expect(c.form()).toMatchObject({ store: false, warehouse: false });
		c.set('office', true as never);
		expect(c.form()).toMatchObject({ office: true, warehouse: false, store: false });
		c.set('warehouse', true as never);
		expect(c.form()).toMatchObject({ warehouse: true, office: false });
		c.set('store', false as never);
		c.set('office', false as never);
		c.set('stateCode', '27' as never);
		expect(c.registrationChoices().map((row) => row.id)).toEqual(['reg_2']);
		c.set('gstRegistrationId', 'reg_2' as never);
		c.set('stateCode', '19' as never);
		expect(c.form().gstRegistrationId).toBeNull();
		c.set('pettyCashFloatINR', -5 as never);
		await c.save();
		expect(gateway.create).toHaveBeenCalledWith(expect.objectContaining({ pettyCashFloatINR: 0 }));
		expect(router.navigate).toHaveBeenCalledWith(['/setting/locations']);
		await c.toggleActive();
		expect(gateway.setActive).not.toHaveBeenCalled();
		expect(make(LocationFormPage).c.isNew()).toBe(true);
	});

	it('edits a saved location, switches it off, and words a refusal', async () => {
		put(LOCATION_KEYS.list, [location(), location({ id: 'loc_2', active: false })]);
		const { c, fixture } = make(LocationFormPage, { id: 'loc_1' });
		fixture.detectChanges();
		expect(c.form()).toMatchObject({ name: 'College Street shop', expectedUpdatedAt: '2026-11-23T00:00:00.000Z' });
		expect(c.form()).not.toHaveProperty('people');
		await c.save();
		expect(gateway.save).toHaveBeenCalledWith('loc_1', expect.objectContaining({ pettyCashFloatINR: 500 }));
		await c.toggleActive();
		expect(gateway.setActive).toHaveBeenCalledWith('loc_1', false);
		gateway.save.mockReturnValueOnce(
			throwError(() => ({ error: { error: { message: 'location_problem:state_gst' } } })),
		);
		await c.save();
		expect(notifier.showError).toHaveBeenCalledWith('location_problem_state_gst');
		gateway.save.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.save();
		expect(notifier.showError).toHaveBeenCalledWith('location_save_failed');
		const reader = make(LocationFormPage, { id: 'loc_1' }, []);
		await reader.c.save();
		await reader.c.toggleActive();
		expect(gateway.save).toHaveBeenCalledTimes(3);
		const missing = make(LocationFormPage, { id: 'loc_9' });
		expect(missing.c.current()).toBeNull();
		h.data.clear();
		h.bump();
		expect(missing.c.registrationChoices()).toEqual([]);
		for (const options of h.options) await options().queryFn();
	});
});

describe('An admin user’s locations (L1)', () => {
	it('reads where the person works and what they will see', () => {
		put(LOCATION_KEYS.list, [
			location(),
			location({ id: 'loc_2', name: 'Godown' }),
			location({ id: 'loc_3', active: false }),
		]);
		put(LOCATION_KEYS.user('adm_2'), {
			worksAt: ['loc_1'],
			homeLocationId: 'loc_1',
			maySwitch: false,
			maySeeAll: false,
		});
		const { c, fixture } = make(AdminUserLocationsCard, { id: 'adm_2' });
		fixture.detectChanges();
		expect(c.active().map((row) => row.id)).toEqual(['loc_1', 'loc_2']);
		expect(c.sees()).toBe('user_loc_sees_fixed(College Street shop)');
		c.maySwitch.set(true);
		expect(c.sees()).toBe('user_loc_sees_switch(College Street shop)');
		c.maySeeAll.set(true);
		expect(c.sees()).toBe('user_loc_sees_all');
		c.maySeeAll.set(false);
		c.toggle('loc_1', false);
		expect(c.homeLocationId()).toBeNull();
		expect(c.sees()).toBe('user_loc_sees_none');
		c.toggle('loc_2', true);
		expect(c.homeLocationId()).toBe('loc_2');
		c.toggle('loc_1', true);
		c.toggle('loc_1', true);
		expect(c.worksAt()).toEqual(['loc_2', 'loc_1']);
		expect(c.homeLocationId()).toBe('loc_2');
		c.toggle('loc_2', false);
		expect(c.homeLocationId()).toBe('loc_1');
		c.toggle('loc_1', false);
		c.toggle('loc_3', false);
	});

	it('saves where the person works, and says when it could not', async () => {
		const { c } = make(AdminUserLocationsCard, { id: 'adm_2' });
		expect(c.active()).toEqual([]);
		c.toggle('loc_1', true);
		await c.save();
		expect(gateway.saveAdminUserLocations).toHaveBeenCalledWith('adm_2', {
			worksAt: ['loc_1'],
			homeLocationId: 'loc_1',
			maySwitch: false,
			maySeeAll: false,
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('user_loc_saved');
		gateway.saveAdminUserLocations.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.save();
		expect(notifier.showError).toHaveBeenCalledWith('user_loc_save_failed');
		const noUser = make(AdminUserLocationsCard);
		await noUser.c.save();
		const reader = make(AdminUserLocationsCard, { id: 'adm_2' }, []);
		await reader.c.save();
		expect(gateway.saveAdminUserLocations).toHaveBeenCalledTimes(2);
		for (const options of h.options) {
			void options().enabled;
			await options().queryFn();
		}
	});
});
