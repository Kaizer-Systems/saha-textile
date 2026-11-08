import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { CompareStore, COMPARE_LIMIT } from '@core/state/compare/compare.store';
import { WishlistStore, WISHLIST_GUEST_LIMIT } from '@core/state/wishlist/wishlist.store';
import { ProductService } from '@data-access/services/product.service';
import { WishlistService } from '@data-access/services/wishlist.service';

import { readCookieList, writeCookieList } from './session-cookie-list';

/** A document whose cookie behaves like a browser's: assignments add or remove one entry. */
const cookieJar = () => {
	const jar = new Map<string, string>();
	return {
		get cookie() {
			return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
		},
		set cookie(line: string) {
			const [pair] = line.split('; ');
			const [name, value = ''] = (pair ?? '').split('=');
			if (!name) return;
			if (line.includes('Max-Age=0')) jar.delete(name);
			else jar.set(name, value);
		},
	};
};

describe('session cookie lists', () => {
	it('reads clean, unique ids up to the limit', () => {
		expect(readCookieList('a=1; st_wishlist=p1%2Cp2%2Cp1%2Cbad%20id', 'st_wishlist', 50)).toEqual(['p1', 'p2']);
		expect(readCookieList('st_wishlist=p1%2Cp2%2Cp3', 'st_wishlist', 2)).toEqual(['p1', 'p2']);
		expect(readCookieList('other=1', 'st_wishlist', 5)).toEqual([]);
		expect(readCookieList('st_wishlist=%E0%A4%A', 'st_wishlist', 5)).toEqual([]);
	});

	it('writes a session cookie, or removes it when empty', () => {
		expect(writeCookieList('st_compare', ['a', 'b'])).toBe('st_compare=a%2Cb; Path=/; SameSite=Lax; Secure');
		expect(writeCookieList('st_compare', [])).toBe('st_compare=; Max-Age=0; Path=/; SameSite=Lax; Secure');
	});
});

const toastr = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
const transloco = { translate: vi.fn((key: string) => key) };

describe('WishlistStore', () => {
	const authenticated = signal(false);
	const resolving = signal(false);
	let doc: ReturnType<typeof cookieJar>;
	const api = {
		account: vi.fn(() => of({ productIds: ['p9'], items: [{ id: 'p9' }] })),
		add: vi.fn((id: string) => of({ productIds: [id, 'p9'] })),
		remove: vi.fn(() => of({ productIds: ['p9'] })),
		merge: vi.fn((ids: string[]) => of({ productIds: [...ids, 'p9'] })),
		cards: vi.fn((ids: string[]) => of(ids.map((id) => ({ id })))),
	};

	const setup = (platform = 'browser') => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: WishlistService, useValue: api },
				{ provide: AuthStore, useValue: { isAuthenticated: authenticated, isResolving: resolving } },
				{ provide: ToastrService, useValue: toastr },
				{ provide: TranslocoService, useValue: transloco },
				{ provide: DOCUMENT, useValue: doc },
				{ provide: PLATFORM_ID, useValue: platform },
			],
		});
		return TestBed.inject(WishlistStore);
	};

	beforeEach(() => {
		doc = cookieJar();
		authenticated.set(false);
		resolving.set(false);
		vi.clearAllMocks();
	});

	it('keeps a guest list in the session cookie and toasts each change', async () => {
		const store = setup();
		TestBed.tick();
		await store.toggle({ id: 'p1' });
		expect(store.has('p1')).toBe(true);
		expect(doc.cookie).toBe('st_wishlist=p1');
		expect(toastr.success).toHaveBeenLastCalledWith('wishlist_added');
		await store.toggle({ id: 'p1' });
		expect(store.has('p1')).toBe(false);
		expect(doc.cookie).toBe('');
		expect(toastr.success).toHaveBeenLastCalledWith('wishlist_removed');
		await store.toggle(null);
		expect(store.has(undefined)).toBe(false);
		expect(api.add).not.toHaveBeenCalled();
	});

	it('stops a guest at the limit', async () => {
		doc.cookie = writeCookieList(
			'st_wishlist',
			Array.from({ length: WISHLIST_GUEST_LIMIT }, (_, i) => `s${i}`),
		);
		const store = setup();
		TestBed.tick();
		await store.toggle({ id: 'p1' });
		expect(store.has('p1')).toBe(false);
		expect(toastr.error).toHaveBeenCalledWith('wishlist_full');
	});

	it('merges the guest list on sign-in and clears the cookie', async () => {
		doc.cookie = writeCookieList('st_wishlist', ['g1']);
		authenticated.set(true);
		const store = setup();
		await store.sync();
		expect(api.merge).toHaveBeenCalledWith(['g1']);
		expect(store.ids()).toEqual(['g1', 'p9']);
		expect(doc.cookie).toBe('');
		await store.sync();
		expect(api.account).toHaveBeenCalled();
		expect(store.items()).toEqual([{ id: 'p9' }]);
	});

	it('saves to the account and puts the heart back when refused', async () => {
		authenticated.set(true);
		const store = setup();
		await store.sync();
		await store.toggle({ id: 'p1' });
		expect(api.add).toHaveBeenCalledWith('p1');
		expect(store.ids()).toEqual(['p1', 'p9']);
		await store.toggle({ id: 'p1' });
		expect(api.remove).toHaveBeenCalledWith('p1');
		api.add.mockReturnValueOnce(throwError(() => new Error('offline')));
		await store.toggle({ id: 'p2' });
		expect(store.has('p2')).toBe(false);
		expect(toastr.error).toHaveBeenCalledWith('wishlist_not_saved');
	});

	it('keeps the hearts outlined when the account cannot be read', async () => {
		authenticated.set(true);
		api.account.mockReturnValueOnce(throwError(() => new Error('down')));
		const store = setup();
		await store.sync();
		expect(store.owner()).toBe('account');
		expect(store.ids()).toEqual([]);
	});

	it('loads the page from the account or from the guest cookie', async () => {
		doc.cookie = writeCookieList('st_wishlist', ['g1', 'g2']);
		const store = setup();
		await store.loadPage();
		expect(api.cards).toHaveBeenCalledWith(['g1', 'g2']);
		expect(store.items()).toEqual([{ id: 'g1' }, { id: 'g2' }]);
		authenticated.set(true);
		await store.loadPage();
		expect(store.items()).toEqual([{ id: 'p9' }]);
		api.account.mockReturnValueOnce(throwError(() => new Error('down')));
		await store.loadPage();
		expect(store.items()).toEqual([]);
		expect(store.loading()).toBe(false);
	});

	it('follows the session in the browser only', async () => {
		resolving.set(true);
		const store = setup();
		TestBed.tick();
		expect(store.owner()).toBe('none');
		resolving.set(false);
		TestBed.tick();
		await Promise.resolve();
		expect(store.owner()).toBe('guest');
		const server = setup('server');
		TestBed.tick();
		expect(server.owner()).toBe('none');
	});
});

describe('CompareStore', () => {
	let doc: ReturnType<typeof cookieJar>;
	const products = {
		getProductPage: vi.fn((slug: string) =>
			slug === 'gone' ? throwError(() => new Error('404')) : of({ id: slug, slug }),
		),
	};

	const setup = (platform = 'browser') => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ProductService, useValue: products },
				{ provide: ToastrService, useValue: toastr },
				{ provide: TranslocoService, useValue: transloco },
				{ provide: DOCUMENT, useValue: doc },
				{ provide: PLATFORM_ID, useValue: platform },
			],
		});
		return TestBed.inject(CompareStore);
	};

	beforeEach(() => {
		doc = cookieJar();
		vi.clearAllMocks();
	});

	it('toggles up to four products in the session cookie', () => {
		const store = setup();
		for (const slug of ['a', 'b', 'c', 'd']) store.toggle({ slug });
		expect(store.count()).toBe(COMPARE_LIMIT);
		expect(doc.cookie).toBe('st_compare=a%2Cb%2Cc%2Cd');
		store.toggle({ slug: 'e' });
		expect(store.has('e')).toBe(false);
		expect(toastr.warning).toHaveBeenCalledWith('compare_full');
		store.toggle({ slug: 'a' });
		expect(store.has('a')).toBe(false);
		expect(toastr.success).toHaveBeenLastCalledWith('compare_removed');
		store.toggle(undefined);
		expect(store.has(undefined)).toBe(false);
	});

	it('reads the list back and loads each product, dropping one that left the shop', async () => {
		doc.cookie = writeCookieList('st_compare', ['a', 'gone']);
		const store = setup();
		expect(store.slugs()).toEqual(['a', 'gone']);
		await store.loadPage();
		expect(store.items()).toEqual([{ id: 'a', slug: 'a' }]);
		expect(store.slugs()).toEqual(['a']);
		store.remove('a');
		expect(store.items()).toEqual([]);
		expect(doc.cookie).toBe('');
	});

	it('leaves cookies alone on the server', () => {
		doc.cookie = writeCookieList('st_compare', ['a']);
		const store = setup('server');
		expect(store.slugs()).toEqual([]);
		store.toggle({ slug: 'b' });
		expect(doc.cookie).toBe('st_compare=a');
	});
});
