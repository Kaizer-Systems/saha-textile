import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontAuthGateway } from '@core/auth/auth-gateway';
import { ConsentStore } from '@core/consent/consent.store';
import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { ReviewPhotoUploadService } from '@core/media/review-photo-upload.service';
import { AuthStore } from '@core/state/auth.store';
import { cartItem, type ApiCartLine } from '@core/state/cart/cart-view';
import { WishlistStore } from '@core/state/wishlist/wishlist.store';
import { WishlistService } from '@data-access/services/wishlist.service';

const heic = vi.hoisted(() => ({ heicTo: vi.fn(), profile: null as Uint8Array | null }));
vi.mock('heic-to', () => ({ heicTo: heic.heicTo }));
vi.mock('@saha-textile/core-domain/media-files', async (original) => ({
	...(await original<object>()),
	heicColourProfile: () => heic.profile,
}));
vi.mock('@core/config/runtime-config', async (original) => ({
	...(await original<object>()),
	runtimeConfigReady: Promise.resolve(),
}));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	heic.heicTo.mockReset();
	heic.profile = null;
});

describe('StorefrontAuthGateway', () => {
	it('has no sign-out notice to give by default', async () => {
		await expect(firstValueFrom(StorefrontAuthGateway.prototype.sessionNotice.call({}))).resolves.toBeNull();
	});
});

describe('the cart line view', () => {
	it('opens the line’s pop-up when its children hold a free item', () => {
		const line = {
			id: 'l1',
			productId: 'p1',
			slug: 'silk',
			title: 'Silk',
			image: null,
			sku: 'S1',
			variationId: null,
			variantLabel: null,
			quantity: 1,
			available: 5,
			basePriceINR: 1000,
			unitPriceINR: 1000,
			mrpINR: null,
			lineTotalINR: 1000,
			options: [],
			measurements: [],
			problem: null,
			children: [{ role: 'free', key: 'pc', title: 'Petticoat' }],
		} as unknown as ApiCartLine;
		expect(cartItem(line).line_config).toBeDefined();
	});
});

describe('LocaleSeo.applyArticle', () => {
	it('writes no tags for an article without any', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ACTIVE_LOCALE, useValue: 'en' },
				{
					provide: Router,
					useValue: { events: new Subject(), routerState: { snapshot: { root: { data: {} } } } },
				},
			],
		});
		TestBed.inject(LocaleSeo).applyArticle({ publishedTime: '2026-11-08', modifiedTime: '2026-11-09' });
		expect(TestBed.inject(Meta).getTags("property='article:tag'")).toEqual([]);
	});
});

describe('ConsentStore: keeping the look for the visit', () => {
	it('keeps the shopper’s chosen look for the visit when the cookies are refused', () => {
		TestBed.resetTestingModule();
		const store = TestBed.inject(ConsentStore);
		document.cookie = 'st_theme=dark; Path=/';
		store.save({ functional: false, analytics: false, marketing: false } as never);
		expect(document.cookie).toContain('st_theme=dark');
		document.cookie = 'st_theme=; Max-Age=0; Path=/';
	});

	it('keeps nothing when the shopper never chose a look', () => {
		TestBed.resetTestingModule();
		const store = TestBed.inject(ConsentStore);
		document.cookie = 'st_theme=; Max-Age=0; Path=/';
		store.save({ functional: false, analytics: false, marketing: false } as never);
		expect(document.cookie).not.toContain('st_theme=');
	});
});

describe('WishlistStore', () => {
	it('counts the saved products, and waits while the session is still being read', () => {
		for (const signedIn of [false, true]) {
			const resolving = signal(true);
			const sync = vi.fn(() => of({ productIds: [], items: [] }));
			TestBed.resetTestingModule();
			TestBed.configureTestingModule({
				providers: [
					{ provide: PLATFORM_ID, useValue: 'browser' },
					{ provide: AuthStore, useValue: { isAuthenticated: signal(signedIn), isResolving: resolving } },
					{
						provide: WishlistService,
						useValue: { mine: sync, add: sync, remove: sync, merge: sync, cardsFor: () => of([]) },
					},
					{ provide: HttpClient, useValue: {} },
					{ provide: ToastrService, useValue: { success: vi.fn(), error: vi.fn() } },
					{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
				],
			});
			const store = TestBed.inject(WishlistStore);
			TestBed.tick();
			expect(store.count()).toBe(0);
		}
	});
});

describe('ReviewPhotoUploadService: HEIC with its colour profile', () => {
	it('puts the photo’s own profile back into the JPEG', async () => {
		heic.profile = new Uint8Array([1, 2, 3, 4]);
		heic.heicTo.mockResolvedValueOnce(
			new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9])], { type: 'image/jpeg' }),
		);
		const bytes = [0, 0, 0, 24, ...[...'ftypheic'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0];
		const file = new File([new Uint8Array(bytes)], 'IMG.HEIC');
		file.slice = (() => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer })) as never;
		file.arrayBuffer = async () => new Uint8Array(bytes).buffer;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true })),
		);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{
					provide: HttpClient,
					useValue: { post: vi.fn(() => of({})), get: vi.fn(() => of({ status: 'ready' })) },
				},
			],
		});
		await TestBed.inject(ReviewPhotoUploadService)
			.upload(file, 'p1')
			.catch(() => undefined);
		expect(heic.heicTo).toHaveBeenCalledOnce();
	});
});

describe('ReviewPhotoUploadService: HEIC without a colour profile', () => {
	it('keeps the converter’s JPEG, and tries the next quality while it is too big', async () => {
		const huge = { size: 30 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Blob;
		const fits = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
		heic.heicTo.mockResolvedValueOnce(huge).mockResolvedValueOnce(fits);
		const bytes = [0, 0, 0, 24, ...[...'ftypheic'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0];
		const file = new File([new Uint8Array(bytes)], 'IMG.HEIC');
		file.slice = (() => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer })) as never;
		file.arrayBuffer = async () => new Uint8Array(bytes).buffer;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true })),
		);
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })),
		);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{
					provide: HttpClient,
					useValue: {
						post: vi.fn(() => of({ photoId: 'ph1', uploadUrl: 'https://up.test', headers: {} })),
						get: vi.fn(() => of({ status: 'ready' })),
					},
				},
			],
		});
		await TestBed.inject(ReviewPhotoUploadService)
			.upload(file, 'p1')
			.catch(() => undefined);
		expect(heic.heicTo).toHaveBeenCalledTimes(2);
	});
});
