import { HttpErrorResponse } from '@angular/common/http';
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
import { fillKey, shapeBox, shapeLabel, sizesLabel } from './profile-words';

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

const setup = (rows: unknown[], options: { result?: 'yes' | 'no'; permissions?: string[] } = {}) => {
	query.data = signal<unknown>(rows);
	const gateway = {
		update: vi.fn((key: string, update: { enabled?: boolean }) => of({ key, enabled: update.enabled ?? true })),
		remove: vi.fn(() => of(undefined)),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const client = { invalidateQueries: vi.fn() };
	const modal = {
		open: vi.fn(() => ({ result: options.result === 'no' ? Promise.reject('cancel') : Promise.resolve('yes') })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MediaProfilesGateway, useValue: gateway },
			{ provide: QueryClient, useValue: client },
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
			{
				provide: AuthStore,
				useValue: { permissions: () => options.permissions ?? ['setting.index', 'setting.edit'] },
			},
		],
	});
	TestBed.overrideComponent(ImageProfilesSettings, {
		set: { imports: [], template: '<ng-template #profileConfirm></ng-template>' },
	});
	const fixture = TestBed.createComponent(ImageProfilesSettings);
	fixture.detectChanges();
	return { page: fixture.componentInstance, gateway, notifier, modal, client };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('profile wording (F01)', () => {
	it('names shapes, sizes and fills the way the list shows them', () => {
		expect(shapeLabel({ width: 3, height: 4 })).toBe('3:4');
		expect(shapeLabel({ width: 1200, height: 630 })).toBe('1.91:1');
		expect(shapeLabel({ width: 400, height: 100 })).toBe('4.00:1');
		expect(shapeLabel(null)).toBeNull();
		expect(shapeBox({ width: 21, height: 9 })).toEqual({ width: 26, height: 11 });
		expect(shapeBox({ width: 3, height: 4 })).toEqual({ width: 20, height: 26 });
		expect(sizesLabel({ thumb: [150, 300], zoom: [2000] })).toBe('150 – 2000 px');
		expect(sizesLabel({ share: [1200] })).toBe('1200 px');
		expect(sizesLabel({})).toBe('—');
		expect(fillKey('white', true)).toBe('profile_fill_white_background');
		expect(fillKey('white', false)).toBe('profile_fill_white');
	});
});

describe('ImageProfilesSettings', () => {
	it('names built-in profiles by their translation and others by the typed name', () => {
		const { page } = setup([row('product_3x4', { builtIn: true }), row('saree_2x3', { name: 'Saree 2:3' })]);
		expect(page.name(page.rows()[0] as never)).toBe('profile_name_product_3x4');
		expect(page.name(page.rows()[1] as never)).toBe('Saree 2:3');
		expect(page.shape(row('x', { shape: null }) as never)).toBe('profile_keep_shape');
		expect(page.smallest(page.rows()[0] as never)).toBe('profile_min_wide:{"px":2560}');
		expect(page.smallest(row('x', { minSize: null }) as never)).toBe('—');
		expect(page.fills(page.rows()[0] as never)).toBe('profile_fill_crop and profile_fill_blur');
		expect(page.fills(row('l', { mainPhotoOnly: true, fills: ['blur'] }) as never)).toContain('profile_fill_fixed');
		expect(page.mb(25 * 1024 * 1024)).toBe(25);
		expect(page.canEdit()).toBe(true);
	});

	it('switches a profile off in place, and puts the switch back when refused', async () => {
		const { page, gateway, notifier } = setup([row('hero_21x9')]);
		const input = { checked: false } as HTMLInputElement;
		await page.toggle(page.rows()[0] as never, { target: input } as never);
		expect(gateway.update).toHaveBeenCalledWith('hero_21x9', { enabled: false });
		expect(notifier.showSuccess).toHaveBeenCalled();
		gateway.update.mockReturnValueOnce(
			throwError(() => new HttpErrorResponse({ status: 400, error: { issues: [{ code: 'in_use' }] } })),
		);
		const again = { checked: false } as HTMLInputElement;
		await page.toggle(page.rows()[0] as never, { target: again } as never);
		expect(again.checked).toBe(true);
		expect(notifier.showError).toHaveBeenCalledWith('profile_error_in_use');
	});

	it('turns off a profile photos use instead of deleting it (F03), and deletes an unused one after asking', async () => {
		const used = setup([row('hero_16x9', {}, 12)]);
		used.page.askDelete(used.page.rows()[0] as never);
		expect(used.page.ask()?.kind).toBe('turn_off');
		await flush();
		expect(used.gateway.update).toHaveBeenCalledWith('hero_16x9', { enabled: false });
		expect(used.gateway.remove).not.toHaveBeenCalled();

		const unused = setup([row('saree_2x3')]);
		unused.page.askDelete(unused.page.rows()[0] as never);
		expect(unused.page.ask()?.kind).toBe('delete');
		await flush();
		expect(unused.gateway.remove).toHaveBeenCalledWith('saree_2x3');

		const cancelled = setup([row('saree_2x3')], { result: 'no' });
		cancelled.page.askDelete(cancelled.page.rows()[0] as never);
		await flush();
		expect(cancelled.gateway.remove).not.toHaveBeenCalled();
		expect(cancelled.page.ask()).toBeNull();
	});
});
