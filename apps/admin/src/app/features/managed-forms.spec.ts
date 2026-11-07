import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminNotificationsGateway } from '@core/admin-notifications/admin-notifications.gateway';
import { AdminRolesGateway } from '@core/admin-roles/admin-roles.gateway';
import { AdminUsersGateway } from '@core/admin-users/admin-users.gateway';
import { AdminAuthGateway } from '@core/auth/auth-gateway';
import { SettingStore } from '@core/state/setting.store';
import { FaqService } from '@data-access/services/faq.service';
import { PointService } from '@data-access/services/point.service';
import { SettingService } from '@data-access/services/setting.service';
import { StoreService } from '@data-access/services/store.service';

import { CustomerLedger } from './customer-ledger/customer-ledger';
import { FormFaq } from './faq/form-faq/form-faq';
import { Point } from './point/point';
import { FormRole } from './role/form-role/form-role';
import { Permissions } from './role/permissions/permissions';
import { NotificationSettings } from './setting/notification-settings/notification-settings';
import { Setting } from './setting/setting';
import { FormStore } from './store/form-store/form-store';
import { FormTag } from './tag/form-tag/form-tag';
import { FormAdminUser } from './user/form-user/form-user';

const client = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
const q = {
	role: signal<unknown>(undefined),
	modules: signal<unknown>(undefined),
	authority: signal<unknown>(undefined),
	users: signal<unknown>(undefined),
	invite: signal<unknown>(undefined),
	tag: signal<unknown>(undefined),
	countries: signal<unknown>(undefined),
	states: signal<unknown>(undefined),
	currencies: signal<unknown>(undefined),
	customers: signal<unknown>(undefined),
	orders: signal<unknown>(undefined),
	provider: signal<unknown>(undefined),
	channels: signal<unknown>(undefined),
	templates: signal<unknown>(undefined),
};
const call = (...getters: (undefined | (() => unknown))[]) => getters.forEach((getter) => getter?.());

vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQueryClient: () => client,
	injectMutation: (build: () => { mutationFn: (vars: unknown) => Promise<unknown>; onSuccess?: () => void }) => {
		const options = build();
		return { mutate: (vars: unknown) => void options.mutationFn(vars).then(() => options.onSuccess?.()) };
	},
}));
vi.mock('@data-access/queries/role.queries', () => ({
	injectRoleQuery: (id: () => unknown) => (call(id), { data: q.role }),
	injectRoleModulesQuery: () => ({ data: q.modules }),
}));
vi.mock('@data-access/queries/admin-users.queries', () => ({
	injectAdminUserAuthorityQuery: (id: () => unknown) => (call(id), { data: q.authority }),
	injectAdminUsersQuery: (params: () => unknown) => (call(params), { data: q.users }),
	injectRolesForInviteQuery: () => ({ data: q.invite }),
}));
vi.mock('@data-access/queries/tag.queries', () => ({
	injectTagQuery: (id: () => unknown) => (call(id), { data: q.tag }),
}));
vi.mock('@data-access/queries/country.queries', () => ({ injectCountriesQuery: () => ({ data: q.countries }) }));
vi.mock('@data-access/queries/state.queries', () => ({ injectStatesQuery: () => ({ data: q.states }) }));
vi.mock('@data-access/queries/currency.queries', () => ({
	injectCurrenciesQuery: (params: () => unknown) => (call(params), { data: q.currencies }),
}));
vi.mock('@data-access/queries/admin-customers.queries', () => ({
	injectAdminCustomersQuery: (params: () => unknown) => (call(params), { data: q.customers }),
	injectAdminCustomerOrdersQuery: (id: () => unknown, params: () => unknown) => (
		call(id, params),
		{ data: q.orders }
	),
}));
vi.mock('@data-access/queries/admin-notifications.queries', () => ({
	injectNotificationProviderQuery: () => ({ data: q.provider }),
	injectNotificationChannelsQuery: () => ({ data: q.channels }),
	injectNotificationTemplatesQuery: () => ({ data: q.templates }),
}));

const render = <T>(
	type: Type<T>,
	providers: unknown[] = [],
	inputs: Record<string, unknown> = {},
	params: Record<string, unknown> = {},
) => {
	const router = { navigateByUrl: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: router },
			{
				provide: ActivatedRoute,
				useValue: {
					params: new BehaviorSubject(params),
					snapshot: { paramMap: { get: (key: string) => (params[key] as string) ?? null } },
				},
			},
			...(providers as never[]),
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, router };
};
const settle = async () => {
	for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

afterEach(() => {
	for (const value of Object.values(q)) value.set(undefined);
	client.invalidateQueries.mockClear();
	document.body.classList.remove('loader-none');
});

describe('FormRole', () => {
	const setup = (inputs: Record<string, unknown> = { type: 'create' }, params: Record<string, unknown> = {}) => {
		const gateway = { create: vi.fn(() => of({})), update: vi.fn(() => of({})) };
		return { ...render(FormRole, [{ provide: AdminRolesGateway, useValue: gateway }], inputs, params), gateway };
	};
	const filled = (form: FormRole) =>
		form.form.patchValue({ name: 'Packer', key: 'packer', baseRole: 'staff', permissions: ['a.read'] });

	it('slugifies the key from the name', () => {
		const { page } = setup();
		page.form.patchValue({ name: ' Warehouse Lead! ' });
		page.onNameBlur();
		expect(page.form.value.key).toBe('warehouse-lead');
		page.form.controls['key']!.setValue('');
		page.form.patchValue({ name: '9 to 5' });
		page.onNameBlur();
		expect(page.form.value.key).toBe('r-9-to-5');
		page.form.patchValue({ name: '***' });
		page.onNameBlur();
		expect(page.form.value.key).toBe('role');
		page.form.patchValue({ name: null });
		page.onNameBlur();
		expect(page.form.value.key).toBe('role');
	});

	it('leaves a typed key alone, and every key when editing', () => {
		const { page } = setup();
		page.form.controls['key']!.setValue('typed');
		page.form.controls['key']!.markAsDirty();
		page.form.patchValue({ name: 'Other' });
		page.onNameBlur();
		expect(page.form.value.key).toBe('typed');
		const editing = setup({ type: 'edit' }, { id: 'r1' });
		editing.page.form.patchValue({ name: 'Other' });
		editing.page.onNameBlur();
		expect(editing.page.form.value.key).toBe('');
	});

	it('takes the permissions from the picker, ignoring anything else', () => {
		const { page } = setup();
		page.setPermissions(['a']);
		expect(page.permissions).toEqual(['a']);
		page.setPermissions('x' as never);
		expect(page.permissions).toEqual(['a']);
	});

	it('fills the form from a custom role', () => {
		const { page } = setup({ type: 'edit' }, { id: 'r1' });
		q.role.set({
			id: 'r1',
			name: 'Packer',
			key: 'packer',
			baseRole: 'admin',
			description: 'D',
			permissions: ['a', { code: 'b' }, { name: 'c' }, { other: 1 }, 5],
		});
		TestBed.tick();
		expect(page.permissions).toEqual(['a', 'b', 'c']);
		expect(page.form.controls['key']?.disabled).toBe(true);
		expect(page.id).toBe('r1');
	});

	it('fills the defaults for a sparse role, and copes with no permission list', () => {
		const { page } = setup({ type: 'edit' }, { id: 'r1' });
		q.role.set({ id: 'r1', name: 'Packer', permissions: 'none' });
		TestBed.tick();
		expect(page.form.getRawValue()).toMatchObject({ key: '', baseRole: 'staff', description: null });
		expect(page.permissions).toEqual([]);
	});

	it('sends a system role back to the list', () => {
		for (const role of [
			{ id: 'r1', isSystem: true },
			{ id: 'r1', system_reserve: '1' },
		]) {
			const { router } = setup({ type: 'edit' }, { id: 'r1' });
			q.role.set(role);
			TestBed.tick();
			expect(router.navigateByUrl).toHaveBeenCalledWith('/role');
			q.role.set(undefined);
		}
	});

	it('ignores a role while creating', () => {
		const { page } = setup();
		q.role.set({ id: 'r1', name: 'x' });
		TestBed.tick();
		expect(page.id).toBeNull();
	});

	it('stops on an invalid form, or no usable permission', () => {
		const { page, gateway } = setup();
		page.submit();
		filled(page);
		page.form.patchValue({ permissions: [{ other: 1 }] });
		page.submit();
		expect(page.form.controls['permissions']?.errors).toEqual({ required: true });
		expect(gateway.create).not.toHaveBeenCalled();
	});

	it('creates, deriving a missing key', async () => {
		const { page, gateway, router } = setup();
		filled(page);
		page.submit();
		await settle();
		expect(gateway.create).toHaveBeenCalledWith({
			key: 'packer',
			label: 'Packer',
			baseRole: 'staff',
			permissions: ['a.read'],
			description: null,
		});
		expect(router.navigateByUrl).toHaveBeenCalledWith('/role');
		const blank = setup();
		filled(blank.page);
		blank.page.form.controls['key']!.clearValidators();
		blank.page.form.controls['key']!.setValue('');
		blank.page.form.patchValue({ description: 'D' });
		blank.page.submit();
		await settle();
		expect(blank.gateway.create).toHaveBeenCalledWith(expect.objectContaining({ key: 'packer', description: 'D' }));
	});

	it('updates a loaded role', async () => {
		const { page, gateway, router } = setup({ type: 'edit' }, { id: 'r1' });
		q.role.set({ id: 'r1', name: 'Packer', key: 'packer', baseRole: 'staff', permissions: ['a'] });
		TestBed.tick();
		page.form.patchValue({ description: 'D' });
		page.submit();
		await settle();
		expect(gateway.update).toHaveBeenCalledWith('r1', { label: 'Packer', permissions: ['a'], description: 'D' });
		expect(router.navigateByUrl).toHaveBeenCalledWith('/role');
		page.form.patchValue({ description: '' });
		page.submit();
		await settle();
		expect(gateway.update).toHaveBeenLastCalledWith('r1', expect.objectContaining({ description: null }));
	});
});

describe('Permissions', () => {
	const module = () => ({
		id: 'a',
		name: 'a',
		isChecked: false,
		module_permissions: [
			{ permission_id: 'a.index', name: 'index', isChecked: false },
			{ permission_id: 'a.edit', name: 'edit', isChecked: false },
		],
	});
	const setup = () => {
		const { page } = render(Permissions);
		const seen: string[][] = [];
		page.setPermissions.subscribe((value) => seen.push([...value]));
		return { page, seen };
	};
	const change = (ids: unknown) => ({ selectedPermission: { currentValue: ids } }) as never;
	const box = (checked: boolean, value = 'a.edit') => ({ target: { checked, value } }) as never;

	it('marks the held permissions when they arrive', () => {
		const held = module();
		q.modules.set([held]);
		const { page } = setup();
		TestBed.tick();
		page.selectedPermission = ['a.index', 'a.edit'];
		page.ngOnChanges(change(['a.index', 'a.edit']));
		expect(held.isChecked).toBe(true);
		page.ngOnChanges({} as never);
		q.modules.set(undefined);
		TestBed.tick();
	});

	it('ticks and unticks a whole module', () => {
		const { page, seen } = setup();
		const held = module();
		page.checkUncheckAll(box(true), held as never);
		expect(page.selectedPermission).toEqual(['a.index', 'a.edit']);
		expect(held.isChecked).toBe(true);
		page.checkUncheckAll(box(false), held as never);
		expect(page.selectedPermission).toEqual([]);
		expect(seen.at(-1)).toEqual([]);
	});

	it('clears a module from its index box', () => {
		const { page } = setup();
		page.selectedPermission = ['a.index', 'a.edit'];
		page.checkIndex(new Event('change'), module() as never);
		expect(page.selectedPermission).toEqual([]);
	});

	it('ticks index along with any other permission', () => {
		const { page } = setup();
		const held = module();
		page.onPermissionChecked(box(true), held as never);
		expect(page.selectedPermission).toEqual(['a.index', 'a.edit']);
		page.onPermissionChecked(box(true), held as never);
		expect(page.selectedPermission).toEqual(['a.index', 'a.edit']);
		page.onPermissionChecked(box(false), held as never);
		expect(page.selectedPermission).toEqual(['a.index']);
	});

	it('treats an empty module as unchecked', () => {
		const { page } = setup();
		const empty = { module_permissions: [], isChecked: true };
		page.updateCheckBoxStatus(empty as never);
		expect(empty.isChecked).toBe(false);
	});
});

describe('FormAdminUser', () => {
	const setup = (inputs: Record<string, unknown> = { type: 'create' }, params: Record<string, unknown> = {}) => {
		const users = {
			setStatus: vi.fn(() => of(undefined)),
			assignRole: vi.fn(() => of({})),
			revokeRole: vi.fn(() => of({})),
		};
		const auth = { createInvite: vi.fn(() => of(undefined)) };
		return {
			...render(
				FormAdminUser,
				[
					{ provide: AdminUsersGateway, useValue: users },
					{ provide: AdminAuthGateway, useValue: auth },
				],
				inputs,
				params,
			),
			users,
			auth,
		};
	};

	it('lists roles not yet assigned', () => {
		const { page } = setup();
		expect(page.assignedRoles()).toEqual([]);
		expect(page.assignableRoleOptions()).toEqual([]);
		q.authority.set({ roles: [{ roleId: 'r1' }] });
		q.invite.set({
			items: [
				{ id: 'r1', label: 'One' },
				{ id: 'r2', label: 'Two' },
			],
		});
		expect(page.assignableRoleOptions()).toEqual([{ label: 'Two', value: 'r2' }]);
	});

	it('fills the form for editing once both reads answer', () => {
		const { page } = setup({ type: 'edit' }, { id: 'u1' });
		q.authority.set({ roles: [] });
		TestBed.tick();
		expect(page.form.value.email).toBe('');
		q.users.set({ items: [{ id: 'u1', email: 'a@b.co', role: 'admin', status: 'active' }] });
		TestBed.tick();
		expect(page.form.get('email')?.disabled).toBe(true);
		expect(page.form.getRawValue()).toMatchObject({ email: 'a@b.co', status: true });
	});

	it('invites from a valid form', async () => {
		const { page, auth, router } = setup();
		page.submit();
		expect(auth.createInvite).not.toHaveBeenCalled();
		page.form.patchValue({ email: 'a@b.co', role: 'admin' });
		page.submit();
		await settle();
		expect(auth.createInvite).toHaveBeenCalledWith({ email: 'a@b.co', role: 'admin' });
		expect(router.navigateByUrl).toHaveBeenCalledWith('/admin-user');
	});

	it('sets the status when editing, and needs an id', async () => {
		const { page, users } = setup({ type: 'edit' }, { id: 'u1' });
		page.form.patchValue({ email: 'a@b.co', status: false });
		page.submit();
		page.form.patchValue({ status: true });
		page.submit();
		await settle();
		expect(users.setStatus).toHaveBeenCalledWith('u1', { status: 'disabled' });
		expect(users.setStatus).toHaveBeenCalledWith('u1', { status: 'active' });
		const noId = setup({ type: 'edit' });
		noId.page.form.patchValue({ email: 'a@b.co' });
		noId.page.submit();
		expect(noId.users.setStatus).not.toHaveBeenCalled();
	});

	it('does nothing for another mode', () => {
		const { page, users, auth } = setup({ type: 'view' });
		page.form.patchValue({ email: 'a@b.co' });
		page.submit();
		expect(users.setStatus).not.toHaveBeenCalled();
		expect(auth.createInvite).not.toHaveBeenCalled();
	});

	it('assigns a role once one is chosen and the user is known', async () => {
		const { page, users } = setup({ type: 'edit' }, { id: 'u1' });
		page.assignRole();
		expect(users.assignRole).not.toHaveBeenCalled();
		page.roleAssignForm.patchValue({ roleId: 'r1' });
		page.assignRole();
		await settle();
		expect(users.assignRole).toHaveBeenCalledWith('u1', 'r1');
		expect(page.roleAssignForm.value.roleId).toBeNull();
		const noId = setup();
		noId.page.roleAssignForm.patchValue({ roleId: 'r1' });
		noId.page.assignRole();
		expect(noId.users.assignRole).not.toHaveBeenCalled();
	});

	it('revokes a role when the user is known', async () => {
		const { page, users } = setup({ type: 'edit' }, { id: 'u1' });
		page.revokeRole('r1');
		await settle();
		expect(users.revokeRole).toHaveBeenCalledWith('u1', 'r1');
		const noId = setup();
		noId.page.revokeRole('r1');
		expect(noId.users.revokeRole).not.toHaveBeenCalled();
	});
});

describe('FormTag', () => {
	it('fills from a saved tag', () => {
		const { page } = render(FormTag, [], { type: 'edit' }, { id: '3' });
		q.tag.set({ name: 'New', description: 'D', status: false });
		TestBed.tick();
		expect(page.form.value).toMatchObject({ name: 'New', status: false });
		expect(page.tag).toMatchObject({ name: 'New' });
	});

	it('tracks the tag type and goes back to the right list', () => {
		const { fixture, page, router } = render(FormTag);
		page.submit();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
		page.form.patchValue({ name: 'New' });
		page.submit();
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/tag');
		fixture.componentRef.setInput('tagType', 'post');
		page.ngOnChanges();
		expect(page.form.value.type).toBe('post');
		page.submit();
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/blog/tag');
	});
});

describe('FormFaq', () => {
	const setup = (params: Record<string, unknown> = {}, rows: unknown[] = []) => {
		const service = { getFaqs: vi.fn(() => of({ data: rows })), save: vi.fn(() => of({})) };
		return { ...render(FormFaq, [{ provide: FaqService, useValue: service }], {}, params), service };
	};

	it('jumps to a field from the language to-do list', () => {
		const { page } = setup();
		page.openLanguageGap({ key: 'title', locale: 'fr' });
		expect(page.fields.locale()).toBe('fr');
	});

	it('fills from a saved question', () => {
		const { page } = setup({ id: 1 }, [
			{
				id: 1,
				faqId: 'f1',
				title: 'Q',
				description: 'A',
				scope: 'product',
				categoryIds: ['c'],
				productIds: ['p', 'q'],
			},
		]);
		expect(page.form.value).toMatchObject({ title: 'Q', scope: 'product', categoryIds: 'c', productIds: 'p, q' });
	});

	it('fills the defaults for a sparse or missing row', () => {
		expect(setup({ id: 1 }, [{ id: 1 }]).page.form.value).toMatchObject({
			scope: 'global',
			categoryIds: '',
			productIds: '',
		});
		expect(setup({ id: 9 }, []).page.faq).toBeNull();
	});

	it('does not read without an id', () => {
		expect(setup().service.getFaqs).not.toHaveBeenCalled();
	});

	it('saves, splitting the id lists, and returns to the list', () => {
		const { page, service, router } = setup();
		page.switchLanguage('fr');
		page.submit();
		expect(service.save).not.toHaveBeenCalled();
		expect(page.fields.locale()).toBe('en');
		expect(page.form.get('title')?.errors).toEqual({ required: true });
		expect(page.form.get('description')?.errors).toEqual({ required: true });
		page.form.patchValue({ title: 'Q', categoryIds: ' c1, ,c2 ', productIds: '' });
		page.submit();
		expect(page.form.get('title')?.errors).toBeNull();
		expect(service.save).not.toHaveBeenCalled();
		page.form.patchValue({ description: 'A' });
		page.switchLanguage('fr');
		expect(page.onSourceLanguage).toBe(false);
		page.form.patchValue({ title: 'Question' });
		page.refreshMissing();
		expect(page.gaps()['fr']?.length).toBe(1);
		page.submit();
		expect((service.save.mock.lastCall as unknown[])[0]).toMatchObject({
			title: 'Q',
			description: 'A',
			titleFr: 'Question',
			descriptionFr: '',
			categoryIds: ['c1', 'c2'],
			productIds: [],
			faqId: undefined,
		});
		expect(router.navigateByUrl).toHaveBeenCalledWith('/faq');
	});

	it('asks only for what is missing, and saves English alone', () => {
		const { page, service } = setup();
		page.form.patchValue({ description: 'A' });
		page.submit();
		expect(page.form.get('title')?.errors).toEqual({ required: true });
		expect(page.form.get('description')?.errors).toBeNull();
		page.form.patchValue({ title: 'Q' });
		page.submit();
		expect((service.save.mock.lastCall as unknown[])[0]).toMatchObject({ titleFr: '', descriptionFr: '' });
	});

	it('keeps the French text of a saved question', () => {
		const { page } = setup({ id: 1 }, [{ id: 1, title: 'Q', titleFr: 'Question', description: 'A', descriptionFr: 'R' }]);
		page.switchLanguage('fr');
		expect(page.form.value).toMatchObject({ title: 'Question', description: 'R' });
		expect(page.fields.source('title')).toBe('Q');
		expect(page.onSourceLanguage).toBe(false);
	});
});

describe('FormStore', () => {
	const setup = (
		inputs: Record<string, unknown> = {},
		params: Record<string, unknown> = {},
		rows: unknown[] = [],
	) => {
		const service = { getStores: vi.fn(() => of({ data: rows })) };
		return { ...render(FormStore, [{ provide: StoreService, useValue: service }], inputs, params), service };
	};
	const complete = {
		store_name: 's',
		description: 'd',
		country_id: 1,
		state_id: 2,
		city: 'c',
		address: 'a',
		pincode: 'p',
		name: 'n',
		email: 'a@b.co',
		phone: '1',
		password: 'pw',
		password_confirmation: 'pw',
	};

	it('fills from a saved store', () => {
		const { page } = setup({ type: 'edit' }, { id: 1 }, [{ id: 1, store_name: 'S', vendor: { name: 'V' } }]);
		expect(page.form.value).toMatchObject({ store_name: 'S', name: 'V' });
		expect(page.id).toBe(1);
	});

	it('copes with a store it cannot find, and an empty address', () => {
		expect(setup({}, { id: 9 }).page.store).toBeNull();
		expect(setup().service.getStores).not.toHaveBeenCalled();
	});

	it('lists countries and the states of the chosen one', async () => {
		q.countries.set([{ id: 1, name: 'India' }]);
		q.states.set([
			{ id: 2, name: 'Bengal', country_id: 1 },
			{ id: 3, name: 'Texas', country_id: 9 },
		]);
		const { page } = setup();
		expect(await firstValueFrom(page.countries$)).toEqual([{ label: 'India', value: 1 }]);
		expect(await firstValueFrom(page.states$)).toHaveLength(2);
		page.countryChange({ value: 1 } as never);
		TestBed.tick();
		expect(await firstValueFrom(page.states$)).toHaveLength(1);
		page.form.patchValue({ state_id: 2 });
		page.countryChange(undefined as never);
		expect(page.form.value.state_id).toBe('');
	});

	it('shows empty lists before they load', async () => {
		const { page } = setup();
		expect(await firstValueFrom(page.countries$)).toEqual([]);
		expect(await firstValueFrom(page.states$)).toEqual([]);
	});

	it('takes a single logo only', () => {
		const { page } = setup();
		page.selectStoreLogo({ id: 5 } as never);
		expect(page.form.value.store_logo_id).toBe(5);
		page.selectStoreLogo(null as never);
		expect(page.form.value.store_logo_id).toBe('');
		page.selectStoreLogo([] as never);
		expect(page.form.value.store_logo_id).toBe('');
	});

	it('flags a mismatch after the confirmation is touched', () => {
		const { page } = setup();
		page.form.patchValue({ password: 'a', password_confirmation: 'b' });
		expect(page.passwordMatchError).toBeFalsy();
		page.form.get('password_confirmation')?.markAsTouched();
		expect(page.passwordMatchError).toBe(true);
	});

	it('goes to the list from a valid form, dropping the password when editing', () => {
		const { page, router } = setup();
		page.submit();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
		page.form.patchValue(complete);
		page.submit();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/store');
		const editing = setup({ type: 'edit' }, { id: 1 }, [{ id: 1, vendor: {} }]);
		editing.page.submit();
		expect(editing.page.form.get('password')).toBeNull();
	});
});

describe('Setting', () => {
	const option = {
		general: {
			site_title: 'Shop',
			default_currency_id: '19',
			default_timezone: 'Asia/Kolkata',
			min_order_amount: 0,
			min_order_free_shipping: 0,
			mode: 'light-only',
		},
		delivery: { same_day_intervals: [{ title: 'Morning', description: '9-12' }] },
	};
	const setup = (values: unknown = option) => {
		const store = { setting: signal(null), update: vi.fn() };
		const parts = render(Setting, [
			{ provide: SettingStore, useValue: store },
			{ provide: SettingService, useValue: { getBackendSettingOption: () => of({ values }) } },
		]);
		return { ...parts, store };
	};

	it('fills the form from the saved settings', () => {
		const { page } = setup();
		expect(page.form.value.general).toMatchObject({ site_title: 'Shop', default_currency_id: 19 });
		expect(page.sameDayIntervals.length).toBe(1);
		expect(setup({}).page.sameDayIntervals.length).toBe(0);
	});

	it('lists the currencies', () => {
		const { page } = setup();
		expect(page.currencies()).toEqual([]);
		q.currencies.set({ data: [{ code: 'INR', id: 1 }] });
		expect(page.currencies()).toEqual([{ label: 'INR', value: 1 }]);
	});

	it.each([
		['selectMaintenance', 'maintenance', 'maintenance_image_id'],
	] as const)('%s stores one image', (method, group, field) => {
		const { page } = setup();
		const value = () => (page.form.value[group] as Record<string, unknown>)[field];
		page[method]({ id: 5 } as never);
		expect(value()).toBe(5);
		page[method](null as never);
		expect(value()).toBeNull();
		page[method]([] as never);
		expect(value()).toBeNull();
	});

	it('adds and removes intervals, keeping at least one', () => {
		const { page } = setup();
		const event = new Event('click', { cancelable: true });
		page.addDays(event);
		expect(event.defaultPrevented).toBe(true);
		expect(page.sameDayIntervals.length).toBe(2);
		page.remove(0);
		page.remove(0);
		expect(page.sameDayIntervals.length).toBe(1);
	});

	it('saves a valid form only', () => {
		const { page, store } = setup();
		page.submit();
		expect(store.update).toHaveBeenCalledOnce();
		page.form.get('general.site_title')?.setValue('');
		page.submit();
		expect(store.update).toHaveBeenCalledOnce();
	});
});

describe('NotificationSettings', () => {
	const setup = () => {
		const gateway = { toggleChannel: vi.fn(() => of({})), upsertTemplate: vi.fn(() => of({})) };
		return {
			...render(NotificationSettings, [{ provide: AdminNotificationsGateway, useValue: gateway }]),
			gateway,
		};
	};
	const template = {
		key: 'k',
		name: 'n',
		channel: 'sms',
		category: 'marketing',
		status: 'approved',
		dltHeaderId: 'h',
		dltTemplateId: null,
		whatsappTemplateId: null,
	};

	it('shows empty lists, then the data', () => {
		const { page } = setup();
		expect(page.provider()).toBeUndefined();
		expect(page.channels()).toEqual([]);
		expect(page.templates()).toEqual([]);
		q.provider.set({ provider: 'msg91' });
		q.channels.set({ items: [{ id: 1 }] });
		q.templates.set({ items: [{ id: 2 }] });
		expect(page.channels()).toHaveLength(1);
		expect(page.templates()).toHaveLength(1);
	});

	it('toggles a channel from its checkbox', async () => {
		const { page, gateway } = setup();
		const row = { channel: 'sms', category: 'marketing' } as never;
		const target = document.createElement('input');
		target.type = 'checkbox';
		target.checked = true;
		page.onEnabledChange(row, { target } as never);
		page.onEnabledChange(row, { target: document.body } as never);
		await settle();
		expect(gateway.toggleChannel).toHaveBeenCalledOnce();
		expect(gateway.toggleChannel).toHaveBeenCalledWith({ channel: 'sms', category: 'marketing', enabled: true });
	});

	it('edits a template, filling missing ids with empty text', () => {
		const { page } = setup();
		page.editTemplate(template as never);
		expect(page.editingKey()).toBe('k');
		expect(page.templateForm.getRawValue()).toMatchObject({
			dltHeaderId: 'h',
			dltTemplateId: '',
			whatsappTemplateId: '',
		});
		page.editTemplate({ ...template, dltHeaderId: null, dltTemplateId: 't', whatsappTemplateId: 'w' } as never);
		expect(page.templateForm.getRawValue()).toMatchObject({
			dltHeaderId: '',
			dltTemplateId: 't',
			whatsappTemplateId: 'w',
		});
	});

	it('refuses an incomplete template', () => {
		const { page, gateway } = setup();
		page.submitTemplate();
		expect(gateway.upsertTemplate).not.toHaveBeenCalled();
		expect(page.templateForm.touched).toBe(true);
	});

	it('saves a template and resets the form', async () => {
		const { page, gateway } = setup();
		page.editTemplate({ ...template, dltTemplateId: 't', whatsappTemplateId: 'w' } as never);
		page.submitTemplate();
		await settle();
		expect(gateway.upsertTemplate.mock.lastCall).toBeDefined();
		expect((gateway.upsertTemplate.mock.lastCall as unknown[])[0]).toMatchObject({
			dltHeaderId: 'h',
			dltTemplateId: 't',
		});
		expect(page.editingKey()).toBeNull();
		page.templateForm.patchValue({ key: 'k', name: 'n' });
		page.submitTemplate();
		await settle();
		expect((gateway.upsertTemplate.mock.lastCall as unknown[])[0]).toMatchObject({
			dltHeaderId: null,
			dltTemplateId: null,
		});
	});
});

describe('CustomerLedger', () => {
	const setup = () => render(CustomerLedger, [{ provide: SettingStore, useValue: { setting: signal(null) } }]);

	it('lists the customers, falling back through the names', async () => {
		const { page } = setup();
		expect(await firstValueFrom(page.customers$)).toEqual([]);
		q.customers.set({ items: [{ id: 'c1', displayName: 'A' }, { id: 'c2', email: 'b' }, { id: 'c3' }] });
		TestBed.tick();
		expect((await firstValueFrom(page.customers$)).map((row) => (row as { label: string }).label)).toEqual([
			'A',
			'b',
			'c3',
		]);
	});

	it('loads orders for the chosen customer, and clears without one', () => {
		const { page } = setup();
		page.form.patchValue({ consumer_id: 'c1' });
		q.orders.set({ items: [{ id: 'o1' }], meta: { total: 1 } });
		TestBed.tick();
		expect(page.tableConfig.data).toEqual([{ id: 'o1', no: 'o1' }]);
		expect(document.body.classList.contains('loader-none')).toBe(true);
		page.form.patchValue({ balance: 5 });
		page.form.patchValue({ consumer_id: '' });
		expect(page.tableConfig.total).toBe(0);
		expect(page.form.value.balance).toBeNull();
	});

	it('turns the table state into order parameters', () => {
		const { page } = setup();
		page.onTableChange();
		page.onTableChange({});
		page.onTableChange({ page: 2, paginate: 5, search: 'x', start_date: '2026-01-01', end_date: '2026-01-02' });
		page.onTableChange({ pageSize: 7, startDate: '2026-01-01', endDate: '2026-01-02' });
		expect(page.tableConfig.data).toEqual([]);
	});

	it('resets the balance on a valid submit only', () => {
		const { page } = setup();
		page.form.patchValue({ balance: 5 });
		page.submit('credit');
		expect(page.form.value.balance).toBe(5);
		page.form.patchValue({ consumer_id: 'c1' });
		page.submit('credit');
		expect(page.form.value.balance).toBeNull();
	});

	it('removes the body class when leaving', () => {
		const { fixture } = setup();
		document.body.classList.add('loader-none');
		fixture.destroy();
		expect(document.body.classList.contains('loader-none')).toBe(false);
	});
});

describe('Point', () => {
	const answer = {
		balance: 50,
		transactions: { data: [{ type: 'credit_note' }, {}], total: 2 },
	};
	const setup = (result: unknown = answer) => {
		const service = { getUserTransaction: vi.fn(() => of(result)) };
		const parts = render(Point, [{ provide: PointService, useValue: service }]);
		return { ...parts, service };
	};

	it('lists the customers', async () => {
		const { page } = setup();
		expect(await firstValueFrom(page.users$)).toEqual([]);
		q.customers.set({ items: [{ id: 'c1', displayName: 'A' }, { id: 'c2', email: 'b' }, { id: 'c3' }] });
		TestBed.tick();
		expect(await firstValueFrom(page.users$)).toHaveLength(3);
	});

	it('loads the transactions for the chosen customer', () => {
		const { page, service } = setup();
		page.onTableChange({ page: 1 });
		expect(service.getUserTransaction).not.toHaveBeenCalled();
		page.form.patchValue({ consumer_id: 'c1' });
		expect(page.balance).toBe(50);
		expect(page.tableConfig.total).toBe(2);
		expect(page.tableConfig.data[0]).toMatchObject({
			type_status: '<div class="status-credit_note"><span>credit note</span></div>',
		});
		expect(page.tableConfig.data[1]).toMatchObject({ type_status: '-' });
		page.onTableChange({ page: 2 });
		expect(service.getUserTransaction).toHaveBeenCalledTimes(2);
	});

	it('copes with an empty answer', () => {
		const { page } = setup(null);
		page.onTableChange({ page: 1 });
		page.form.patchValue({ consumer_id: 'c1' });
		expect(page.balance).toBe(0);
		expect(page.tableConfig.data).toEqual([]);
	});

	it('clears without a customer', () => {
		const { page } = setup();
		page.onTableChange({ page: 1 });
		page.form.patchValue({ consumer_id: 'c1' });
		page.form.patchValue({ consumer_id: '' });
		expect(page.balance).toBe(0);
		expect(page.tableConfig.total).toBe(0);
	});

	it('resets the balance on a valid submit only, and cleans up', () => {
		const { fixture, page } = setup();
		page.onTableChange({ page: 1 });
		page.form.patchValue({ balance: 5 });
		page.submit('credit');
		expect(page.form.value.balance).toBe(5);
		page.form.patchValue({ consumer_id: 'c1' });
		page.submit('credit');
		expect(page.form.value.balance).toBeNull();
		document.body.classList.add('loader-none');
		fixture.destroy();
		expect(document.body.classList.contains('loader-none')).toBe(false);
	});
});
