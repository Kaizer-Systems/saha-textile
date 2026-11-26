import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaProfilesGateway } from '@core/media-profiles/media-profiles.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { ImageProfilesSettings } from './image-profiles';
import { shapeBox } from './profile-words';

const query = vi.hoisted(() => ({ data: undefined as unknown as () => unknown }));
vi.mock('@data-access/queries/media-profiles.queries', async (original) => ({
	...(await original<object>()),
	injectMediaProfilesQuery: () => ({ data: query.data, isPending: () => false }),
}));

const row = (key: string, extra: Record<string, unknown> = {}, photos = 0) => ({
	profile: {
		key,
		name: key,
		builtIn: false,
		shape: { width: 21, height: 9 },
		roles: ['banner'],
		widths: { banner: [480, 2880] },
		quality: null,
		fills: ['crop', 'blur'],
		minSize: { edge: 'width', px: 2560, mode: 'warn' },
		maxBytes: 25 * 1024 * 1024,
		accepts: ['image/jpeg'],
		mainPhotoOnly: false,
		enabled: true,
		version: 1,
		...extra,
	},
	photos,
});

const setup = (rows: unknown, options: { template?: string } = {}) => {
	query.data = signal<unknown>(rows);
	const gateway = {
		update: vi.fn((key: string, update: { enabled?: boolean }) => of({ key, enabled: update.enabled ?? true })),
		remove: vi.fn(() => of(undefined)),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const modal = { open: vi.fn(() => ({ result: Promise.resolve('yes') })) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MediaProfilesGateway, useValue: gateway },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: NgbModal, useValue: modal },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: Record<string, unknown>) =>
						params ? `${key}:${JSON.stringify(params)}` : key,
					getActiveLang: () => 'en',
				},
			},
			{ provide: AuthStore, useValue: { permissions: () => ['setting.index', 'setting.edit'] } },
		],
	});
	TestBed.overrideComponent(ImageProfilesSettings, {
		set: { imports: [], template: options.template ?? '<ng-template #profileConfirm></ng-template>' },
	});
	const fixture = TestBed.createComponent(ImageProfilesSettings);
	fixture.detectChanges();
	return { page: fixture.componentInstance, gateway, notifier, modal };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('image profiles: the last cases', () => {
	it('lists nothing before the profiles arrive, and reads the loading state', () => {
		const { page } = setup(undefined);
		expect(page.rows()).toEqual([]);
		expect(page.loading()).toBe(false);
	});

	it('words a short-edge minimum, a profile that keeps the shape, and one with no fills', () => {
		const { page } = setup([]);
		expect(page.smallest(row('a', { minSize: { edge: 'short', px: 600, mode: 'warn' } }) as never)).toBe(
			'profile_min_short:{"px":600}',
		);
		expect(page.fills(row('b', { shape: null }) as never)).toBe('profile_keep_shape');
		expect(page.fills(row('c', { fills: [] }) as never)).toBe('—');
		expect(shapeBox(null)).toEqual({ width: 26, height: 9 });
	});

	it('says a profile was switched on', async () => {
		const { page, notifier } = setup([]);
		const input = document.createElement('input');
		input.checked = true;
		await page.toggle(row('d', { enabled: false }) as never, { target: input } as unknown as Event);
		expect(notifier.showSuccess).toHaveBeenCalledWith('profile_switched_on:{"name":"d"}');
	});

	it('asks nothing before its popup is drawn, and a confirm with nothing asked does nothing', async () => {
		const { page, modal, gateway } = setup([], { template: '' });
		page.askDelete(row('e') as never);
		expect(modal.open).not.toHaveBeenCalled();
		await (page as unknown as { confirm(): Promise<void> }).confirm();
		expect(gateway.remove).not.toHaveBeenCalled();
	});

	it('a delete that fails for no stated reason says so', async () => {
		const { page, gateway, notifier } = setup([]);
		gateway.remove.mockReturnValueOnce(throwError(() => new Error('network')) as never);
		page.askDelete(row('f') as never);
		await flush();
		await flush();
		expect(notifier.showError).toHaveBeenCalledWith('profile_error_unknown');
		expect(page.ask()).toBeNull();
	});
});
