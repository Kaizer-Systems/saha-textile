import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { StoreLocationGateway } from '@core/stores/store-location.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { StoresSettings } from './stores';

const query = vi.hoisted(() => ({ data: undefined as unknown as () => unknown, pending: false }));
vi.mock('@core/stores/store-location.gateway', async (original) => ({
	...(await original<object>()),
	injectStoreLocationsQuery: () => ({ data: query.data, isPending: () => query.pending }),
}));

const row = (id: string, active = false, gaps: unknown[] = [], name: Record<string, string> = { en: id }) => ({
	store: { id, name, active, pinCode: '700124', phone: '+913325521595' },
	photos: [],
	gaps,
});

const setup = (rows: unknown[] = [row('a'), row('b'), row('c')], permissions = ['setting.index', 'setting.edit']) => {
	const data = signal<unknown>(rows);
	query.data = data;
	const gateway = {
		reorder: vi.fn(() => of({ ok: true })),
		setActive: vi.fn((id: string, active: boolean) => of({ id, active, gaps: [] as unknown[] })),
		remove: vi.fn(() => of({ ok: true })),
	};
	const client = { invalidateQueries: vi.fn() };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: StoreLocationGateway, useValue: gateway },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			{ provide: AuthStore, useValue: { permissions: () => permissions } },
		],
	});
	TestBed.overrideComponent(StoresSettings, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(StoresSettings);
	fixture.detectChanges();
	return { page: fixture.componentInstance, gateway, client, notifier, data, fixture };
};

const ids = (page: StoresSettings) => page.rows().map((r) => r.store.id);

describe('StoresSettings', () => {
	it('shows the stores, their names and what is missing', () => {
		const { page, data, fixture } = setup([
			row('a', true, [{ field: 'name', locale: 'bn' }]),
			row('b', false, [], {}),
		]);
		expect(ids(page)).toEqual(['a', 'b']);
		expect(page.name(page.rows()[1] as never)).toBe('b');
		expect(page.missing(page.rows()[0] as never)).toBe(1);
		expect(page.phone(page.rows()[0] as never)).toBe('+91 33 2552 1595');
		expect(page.phone({ store: { phone: null } } as never)).toBe('—');
		expect(page.canEdit()).toBe(true);
		expect(page.loading()).toBe(false);
		data.set(undefined);
		fixture.detectChanges();
		expect(page.rows()).toEqual([]);
	});

	it('saves a dragged or arrowed order at once', () => {
		const { page, gateway, notifier, client } = setup();
		page.drop({ previousIndex: 0, currentIndex: 2 } as never);
		expect(ids(page)).toEqual(['b', 'c', 'a']);
		expect(gateway.reorder).toHaveBeenLastCalledWith(['b', 'c', 'a']);
		expect(notifier.showSuccess).toHaveBeenCalledWith('store_order_saved');
		expect(client.invalidateQueries).toHaveBeenCalled();
		page.move(1, 0);
		expect(ids(page)).toEqual(['c', 'b', 'a']);
	});

	it('ignores moves that go nowhere and puts the list back when saving fails', () => {
		const { page, gateway } = setup();
		page.move(0, 0);
		page.move(0, -1);
		page.move(2, 3);
		expect(gateway.reorder).not.toHaveBeenCalled();
		gateway.reorder.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		page.move(0, 1);
		expect(ids(page)).toEqual(['a', 'b', 'c']);
	});

	it('switches a store on, or says what stops it', () => {
		const { page, gateway, notifier } = setup([row('a'), row('b', true)]);
		const input = { checked: true } as HTMLInputElement;
		page.toggle(page.rows()[0] as never, { target: input } as never);
		expect(notifier.showSuccess).toHaveBeenCalledWith('store_go_live_done');
		gateway.setActive.mockReturnValueOnce(of({ id: 'a', active: false, gaps: [{ field: 'hours', locale: null }] }));
		page.toggle(page.rows()[0] as never, { target: input } as never);
		expect(input.checked).toBe(false);
		expect(notifier.showError).toHaveBeenCalled();
		const off = { checked: false } as HTMLInputElement;
		notifier.showSuccess.mockClear();
		gateway.setActive.mockReturnValueOnce(of({ id: 'a', active: false, gaps: [] }));
		page.toggle(page.rows()[0] as never, { target: off } as never);
		expect(notifier.showSuccess).not.toHaveBeenCalled();
	});

	it('deletes a store and refreshes', () => {
		const { page, gateway, notifier } = setup();
		page.remove(page.rows()[0] as never);
		expect(gateway.remove).toHaveBeenCalledWith('a');
		expect(notifier.showSuccess).toHaveBeenCalledWith('store_deleted');
	});

	it('reads only, without the edit permission', () => {
		expect(setup(undefined, ['setting.index']).page.canEdit()).toBe(false);
	});
});
