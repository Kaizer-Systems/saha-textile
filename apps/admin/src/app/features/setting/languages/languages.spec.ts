import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminLanguagesGateway } from '@core/admin-languages/admin-languages.gateway';
import { ActiveLanguages } from '@core/i18n/active-languages';
import { NotificationService } from '@data-access/services/notification.service';

import { AREA_LISTS, LanguagesSettings } from './languages';

const state = vi.hoisted(() => ({
	data: undefined as unknown as () => unknown,
	setQueryData: (() => undefined) as (key: unknown, value: unknown) => void,
	invalidated: [] as unknown[],
}));

interface MutateHandlers {
	onSuccess?: (value: unknown) => void;
	onError?: (error: unknown) => void;
	onSettled?: () => void;
}
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQueryClient: () => ({
		setQueryData: (key: unknown, value: unknown) => state.setQueryData(key, value),
		invalidateQueries: (filter: unknown) => void state.invalidated.push(filter),
	}),
	injectMutation: (
		build: () => { mutationFn: (vars: unknown) => Promise<unknown>; onSuccess?: (value: unknown) => void },
	) => {
		const options = build();
		return {
			mutate: (vars: unknown, handlers: MutateHandlers = {}) =>
				void options.mutationFn(vars).then(
					(value) => {
						options.onSuccess?.(value);
						handlers.onSuccess?.(value);
						handlers.onSettled?.();
					},
					(error: unknown) => {
						handlers.onError?.(error);
						handlers.onSettled?.();
					},
				),
		};
	},
}));
vi.mock('@data-access/queries/admin-languages.queries', () => ({
	LANGUAGE_SETTINGS_QUERY_KEY: ['admin-languages'],
	LANGUAGE_REMINDERS_QUERY_KEY: ['admin-language-reminders'],
	injectLanguageSettingsQuery: () => ({ data: state.data, isPending: () => false }),
}));

const row = (code: string, overrides: Record<string, unknown> = {}) => ({
	code,
	admin: true,
	shop: 'on',
	everOn: true,
	addedAt: '2026-11-08T00:00:00.000Z',
	addedBy: null,
	changedAt: null,
	changedBy: null,
	deletedAt: null,
	deletedBy: null,
	remindedAt: null,
	erasedAt: null,
	todo: 0,
	itemsWithText: 2410,
	adminFileComplete: true,
	reminderDue: false,
	addresses: 1936,
	...overrides,
});
const page = {
	default: 'en',
	rows: [
		row('en', { itemsWithText: 0 }),
		row('bn'),
		row('hi', { admin: false, shop: 'draft', everOn: false, todo: 1284 }),
		row('ta', { shop: 'off', deletedAt: '2026-10-01T00:00:00.000Z' }),
	],
	shipped: [
		{ code: 'en', inBoth: true, adminComplete: true, shopComplete: true },
		{ code: 'bn', inBoth: true, adminComplete: true, shopComplete: true },
		{ code: 'hi', inBoth: true, adminComplete: true, shopComplete: true },
		{ code: 'gu', inBoth: true, adminComplete: true, shopComplete: true },
		{ code: 'ta', inBoth: false, adminComplete: false, shopComplete: true },
	],
};
const todo = {
	code: 'hi',
	total: 3,
	lines: [
		{ area: 'admin_text', count: 0, blocksShop: false },
		{ area: 'products', count: 2, blocksShop: true },
		{ area: 'photos', count: 1, blocksShop: true },
	],
};

const refusal = (status: number, code?: string) =>
	new HttpErrorResponse({ status, error: code ? { error: { issues: [{ path: ['request'], code }] } } : {} });

const setup = (query: Record<string, string> = {}) => {
	state.data = signal<unknown>(page);
	const cache: unknown[] = [];
	state.setQueryData = (_key, value) => cache.push(value);
	state.invalidated = [];
	const gateway = {
		settings: vi.fn(() => of(page)),
		todo: vi.fn(() => of(todo)),
		add: vi.fn(() => of(page)),
		switchAdmin: vi.fn(() => of(page)),
		switchShop: vi.fn(() => of(page)),
		remove: vi.fn(() => of(page)),
		keep: vi.fn(() => of(page)),
		erase: vi.fn(() => of(page)),
	};
	let resolve: (value?: unknown) => void = () => undefined;
	const modalRef = {
		result: new Promise((done) => (resolve = done)),
		close: vi.fn(() => resolve()),
		dismiss: vi.fn(() => resolve()),
	};
	const modal = { open: vi.fn(() => modalRef) };
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const languages = { load: vi.fn(async () => undefined) };
	const router = { navigate: vi.fn(async () => true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AdminLanguagesGateway, useValue: gateway },
			{ provide: NgbModal, useValue: modal },
			{ provide: NotificationService, useValue: notifier },
			{ provide: ActiveLanguages, useValue: languages },
			{ provide: Router, useValue: router },
			{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(LanguagesSettings, {
		set: { imports: [], template: '<ng-template #languageDialog></ng-template>' },
	});
	const fixture = TestBed.createComponent(LanguagesSettings);
	fixture.detectChanges();
	return { view: fixture.componentInstance, gateway, modal, modalRef, notifier, cache, languages, router };
};

const toggle = (checked: boolean) => {
	const input = document.createElement('input');
	input.type = 'checkbox';
	input.checked = checked;
	return { event: { target: input } as unknown as Event, input };
};
const flush = () => new Promise((resolve) => setTimeout(resolve));
const at = (code: string) => page.rows.find((entry) => entry.code === code) as never;

afterEach(() => vi.restoreAllMocks());

describe('LanguagesSettings', () => {
	it('lists the languages in use, English first; deleted ones wait for the bell', () => {
		const { view } = setup();
		expect(view.rows().map((entry) => entry.code)).toEqual(['en', 'bn', 'hi']);
		expect(view.name('bn')).toBe('বাংলা');
		expect(view.addable().map((entry) => [entry.code, entry.inBoth])).toEqual([
			['gu', true],
			['ta', false],
		]);
	});

	it('adds the first language this release can, as a draft, and refreshes every list', async () => {
		const { view, gateway, modal, modalRef, cache, languages, notifier } = setup();
		view.openAdd();
		expect(modal.open).toHaveBeenCalledOnce();
		expect(view.addControl.value).toBe('gu');
		view.confirm();
		await flush();
		expect(gateway.add).toHaveBeenCalledWith('gu');
		expect(cache).toEqual([page]);
		expect(languages.load).toHaveBeenCalled();
		expect(modalRef.close).toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('saved');
	});

	it('names a refusal inside the popup', async () => {
		const { view, gateway, modalRef } = setup();
		gateway.add.mockReturnValueOnce(throwError(() => refusal(400, 'not_in_release')));
		view.openAdd();
		view.confirm();
		await flush();
		expect(view.error()).toBe('lang_error_not_in_release');
		expect(modalRef.close).not.toHaveBeenCalled();
	});

	it('switches the Admin switch at once, keeping the box until the API agrees', async () => {
		const { view, gateway, notifier } = setup();
		const { event, input } = toggle(true);
		view.onAdminToggle(at('hi'), event);
		expect(input.checked).toBe(false);
		expect(gateway.switchAdmin).toHaveBeenCalledWith('hi', true);
		gateway.switchAdmin.mockReturnValueOnce(throwError(() => refusal(400, 'admin_text_incomplete')));
		view.onAdminToggle(at('hi'), toggle(true).event);
		await flush();
		expect(notifier.showError).toHaveBeenCalledWith('lang_error_admin_text_incomplete');
	});

	it('refuses the shop switch with the list of what is left, then shows everything', async () => {
		const { view, gateway, modal } = setup();
		view.onShopToggle(at('hi'), toggle(true).event);
		expect(modal.open).toHaveBeenCalledOnce();
		expect(gateway.switchShop).not.toHaveBeenCalled();
		await flush();
		expect(view.dialog()).toMatchObject({ kind: 'shop_blocked', todo });
		view.confirm();
		expect(view.dialog()).toMatchObject({ kind: 'todo' });
	});

	it('asks before the shop shows a complete language, and before it stops', async () => {
		const { view, gateway } = setup();
		view.onShopToggle(row('gu', { shop: 'draft', todo: 0 }) as never, toggle(true).event);
		expect(view.dialog()).toMatchObject({ kind: 'shop_on' });
		view.confirm();
		await flush();
		expect(gateway.switchShop).toHaveBeenCalledWith('gu', true);

		view.onShopToggle(at('bn'), toggle(false).event);
		expect(view.dialog()).toMatchObject({ kind: 'shop_off' });
		view.confirm();
		await flush();
		expect(gateway.switchShop).toHaveBeenLastCalledWith('bn', false);
	});

	it('deletes only once the shop is off', async () => {
		const { view, gateway, notifier } = setup();
		view.openDelete(at('bn'));
		expect(notifier.showError).toHaveBeenCalledWith('lang_error_shop_on');
		view.openDelete(at('hi'));
		expect(view.dialog()).toMatchObject({ kind: 'delete' });
		view.confirm();
		await flush();
		expect(gateway.remove).toHaveBeenCalledWith('hi');
	});

	it('opens erase from the bell, keeps the text on “Keep it”, erases after the typed name', async () => {
		const { view, gateway } = setup({ erase: 'ta' });
		await flush();
		expect(view.dialog()).toMatchObject({ kind: 'erase', row: { code: 'ta' } });
		view.keep();
		await flush();
		expect(gateway.keep).toHaveBeenCalledWith('ta');

		const again = setup({ erase: 'ta' });
		await flush();
		again.view.eraseControl.setValue('தமிழ்');
		again.view.confirm();
		await flush();
		expect(again.gateway.erase).toHaveBeenCalledWith('ta', 'தமிழ்');
	});

	it('opens a to-do line’s list, filtered to what is missing', async () => {
		const { view, router, modalRef } = setup();
		view.openTodo(at('hi'));
		await flush();
		expect(view.dialog()).toMatchObject({ kind: 'todo', todo });
		view.openArea('products', 'hi');
		expect(modalRef.close).toHaveBeenCalled();
		expect(router.navigate).toHaveBeenCalledWith(['/product'], { queryParams: { missing: 'hi' } });
		view.openArea('shop_text', 'hi');
		expect(router.navigate).toHaveBeenCalledOnce();
		expect(Object.keys(AREA_LISTS)).not.toContain('admin_text');
		// Photos the website uses open the Media page, narrowed the same way (media build).
		view.openArea('photos', 'hi');
		expect(router.navigate).toHaveBeenLastCalledWith(['/media/files'], { queryParams: { missing: 'hi' } });
	});
});
