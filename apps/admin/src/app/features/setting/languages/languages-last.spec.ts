import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminLanguagesGateway } from '@core/admin-languages/admin-languages.gateway';
import { ActiveLanguages } from '@core/i18n/active-languages';
import { NotificationService } from '@data-access/services/notification.service';

import { LanguagesSettings } from './languages';

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

interface Options {
	query?: Record<string, string>;
	data?: unknown;
	template?: string;
	settings?: unknown;
}

/** Each popup gets its own reference, so a newer popup can outlive an older one. */
const setup = (options: Options = {}) => {
	state.data = signal<unknown>('data' in options ? options.data : page);
	state.setQueryData = () => undefined;
	state.invalidated = [];
	const gateway = {
		settings: vi.fn(() => of(options.settings ?? page)),
		todo: vi.fn(() => of(todo)),
		add: vi.fn(() => of(page)),
		switchAdmin: vi.fn(() => of(page)),
		switchShop: vi.fn(() => of(page)),
		remove: vi.fn(() => of(page)),
		keep: vi.fn(() => of(page)),
		erase: vi.fn(() => of(page)),
	};
	const refs: Array<{ close: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> }> = [];
	const modal = {
		open: vi.fn(() => {
			let resolve: (value?: unknown) => void = () => undefined;
			const ref = {
				result: new Promise((done) => (resolve = done)),
				close: vi.fn(() => resolve()),
				dismiss: vi.fn(() => resolve()),
			};
			refs.push(ref);
			return ref;
		}),
	};
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AdminLanguagesGateway, useValue: gateway },
			{ provide: NgbModal, useValue: modal },
			{ provide: NotificationService, useValue: notifier },
			{ provide: ActiveLanguages, useValue: { load: vi.fn(async () => undefined) } },
			{ provide: Router, useValue: { navigate: vi.fn(async () => true) } },
			{
				provide: ActivatedRoute,
				useValue: { snapshot: { queryParamMap: convertToParamMap(options.query ?? {}) } },
			},
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(LanguagesSettings, {
		set: { imports: [], template: options.template ?? '<ng-template #languageDialog></ng-template>' },
	});
	const fixture = TestBed.createComponent(LanguagesSettings);
	fixture.detectChanges();
	return { view: fixture.componentInstance, gateway, modal, refs, notifier };
};

const toggle = (checked: boolean) => {
	const input = document.createElement('input');
	input.type = 'checkbox';
	input.checked = checked;
	return { event: { target: input } as unknown as Event, input };
};
const notInput = { target: document.createElement('span') } as unknown as Event;
const flush = () => new Promise((resolve) => setTimeout(resolve));
const at = (code: string) => page.rows.find((entry) => entry.code === code) as never;

describe('LanguagesSettings: the last cases', () => {
	it('lists nothing before the page arrives, and offers no language to add', () => {
		const { view, gateway } = setup({ data: undefined });
		expect(view.rows()).toEqual([]);
		expect(view.addable()).toEqual([]);
		expect(view.shipped('bn')).toBeUndefined();
		view.openAdd();
		expect(view.addControl.value).toBe('');
		view.add();
		expect(gateway.add).not.toHaveBeenCalled();
	});

	it('reads what a shipped language holds, and offers none when none is in both apps', () => {
		const { view } = setup({
			data: { ...page, shipped: [{ code: 'ta', inBoth: false, adminComplete: false, shopComplete: true }] },
		});
		expect(view.shipped('ta')?.inBoth).toBe(false);
		view.openAdd();
		expect(view.addControl.value).toBe('');
	});

	it('opens nothing for a bell reminder whose language is gone', async () => {
		const { modal } = setup({ query: { erase: 'zz' } });
		await flush();
		expect(modal.open).not.toHaveBeenCalled();
	});

	it('ignores a change from something that is not a switch, and every popup before it is drawn', () => {
		const { view, gateway, modal } = setup({ template: '' });
		view.onAdminToggle(at('bn'), notInput);
		view.onShopToggle(at('bn'), notInput);
		expect(gateway.switchAdmin).not.toHaveBeenCalled();
		view.openDelete(at('ta'));
		expect(modal.open).not.toHaveBeenCalled();
		expect(view.dialog()).toBeNull();
		view.confirm();
		view.keep();
		view.cancel();
		expect(gateway.keep).not.toHaveBeenCalled();
	});

	it('closes a to-do list on its main button, and Keep it waits for an erase popup', async () => {
		const { view, refs, gateway } = setup();
		view.openTodo(at('hi'));
		await flush();
		view.keep();
		expect(gateway.keep).not.toHaveBeenCalled();
		view.confirm();
		expect(refs[0]?.close).toHaveBeenCalled();
		await flush();
		expect(view.dialog()).toBeNull();
	});

	it('cancels the open popup, and an older popup closing late leaves the newer one open', async () => {
		const { view, refs } = setup();
		view.openDelete(at('ta'));
		view.openAdd();
		expect(refs[0]?.dismiss).toHaveBeenCalled();
		await flush();
		expect(view.dialog()?.kind).toBe('add');
		view.cancel();
		expect(refs[1]?.dismiss).toHaveBeenCalled();
		await flush();
		expect(view.dialog()).toBeNull();
	});

	it('drops a to-do list that arrives after its popup changed, and says so when it cannot load', async () => {
		const late = setup();
		late.view.openTodo(at('hi'));
		late.view.openAdd();
		await flush();
		expect(late.view.dialog()).toEqual({ kind: 'add' });
		const failed = setup();
		failed.gateway.todo.mockReturnValueOnce(throwError(() => new Error('down')));
		failed.view.openTodo(at('hi'));
		await flush();
		expect(failed.view.error()).toBe('lang_error_not_saved');
	});

	it('names each refusal as a toast outside a popup: a network fault, an unknown language, a rule it has no words for', async () => {
		const { view, gateway, notifier } = setup();
		gateway.switchAdmin.mockReturnValueOnce(throwError(() => new Error('network')));
		view.onAdminToggle(at('bn'), toggle(false).event);
		await flush();
		expect(notifier.showError).toHaveBeenLastCalledWith('lang_error_not_saved');
		gateway.switchAdmin.mockReturnValueOnce(throwError(() => refusal(404)));
		view.onAdminToggle(at('bn'), toggle(false).event);
		await flush();
		expect(notifier.showError).toHaveBeenLastCalledWith('lang_error_unknown_language');
		gateway.switchAdmin.mockReturnValueOnce(throwError(() => refusal(400, 'something_new')));
		view.onAdminToggle(at('bn'), toggle(false).event);
		await flush();
		expect(notifier.showError).toHaveBeenLastCalledWith('lang_error_not_saved');
	});
});
