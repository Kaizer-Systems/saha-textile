import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, computed, effect, inject, untracked } from '@angular/core';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

import { AuthStore } from '@core/state/auth.store';
import { readCookieList, writeCookieList } from '@core/state/lists/session-cookie-list';
import { IProduct } from '@data-access/interfaces/product.interface';
import { WishlistService } from '@data-access/services/wishlist.service';

/** Mirrors `WISHLIST_GUEST_COOKIE` and `WISHLIST_GUEST_LIMIT` in `@saha-textile/contracts`. */
export const WISHLIST_COOKIE = 'st_wishlist';
export const WISHLIST_GUEST_LIMIT = 50;

interface WishlistState {
	/** Saved product ids, newest first. Drives every heart on the page. */
	ids: string[];
	/** Cards for the wishlist page, loaded when that page asks. */
	items: IProduct[];
	/** Who the list belongs to right now. */
	owner: 'none' | 'guest' | 'account';
	loading: boolean;
}

/**
 * The wishlist (owner decision 2026-11-08). A heart toggles: saved → filled red heart and
 * "Added to your wishlist"; pressed again → outline and "Removed from your wishlist".
 *
 * A guest's list lives in the `st_wishlist` session cookie (ids only) and is gone when the
 * browser closes or cookies are cleared. A signed-in customer's list is stored with the account;
 * on sign-in the guest list merges into it and the cookie is cleared. Nothing runs on the server:
 * pages are shared and cached, so hearts render outlined there and fill in once the browser knows.
 */
export const WishlistStore = signalStore(
	{ providedIn: 'root' },
	withState<WishlistState>({ ids: [], items: [], owner: 'none', loading: false }),
	withComputed((store) => ({
		count: computed(() => store.ids().length),
		saved: computed(() => new Set(store.ids())),
	})),
	withMethods(
		(
			store,
			api = inject(WishlistService),
			auth = inject(AuthStore),
			toastr = inject(ToastrService),
			transloco = inject(TranslocoService),
			document = inject(DOCUMENT),
		) => {
			const guestIds = () => readCookieList(document.cookie, WISHLIST_COOKIE, WISHLIST_GUEST_LIMIT);
			const keepGuest = (ids: string[]) => {
				document.cookie = writeCookieList(WISHLIST_COOKIE, ids.slice(0, WISHLIST_GUEST_LIMIT));
			};
			const say = (key: string) => toastr.success(transloco.translate(key));
			const fail = () => toastr.error(transloco.translate('wishlist_not_saved'));
			const dropCards = (ids: string[]) => store.items().filter((item) => ids.includes(String(item.id)));

			const methods = {
				has(productId: string | number | undefined): boolean {
					return productId !== undefined && store.saved().has(String(productId));
				},

				/** Reads the guest cookie, or the account (merging the guest list in first). */
				async sync(): Promise<void> {
					if (!auth.isAuthenticated()) {
						patchState(store, { ids: guestIds(), owner: 'guest' });
						return;
					}
					const pending = guestIds();
					try {
						if (pending.length) {
							const merged = await firstValueFrom(api.merge(pending));
							keepGuest([]);
							patchState(store, { ids: merged.productIds, owner: 'account' });
						} else {
							const { productIds, items } = await firstValueFrom(api.account());
							patchState(store, { ids: productIds, items, owner: 'account' });
						}
					} catch {
						// A failed read leaves the hearts outlined; the next sign-in or page load tries again.
						patchState(store, { owner: 'account' });
					}
				},

				async toggle(product: Pick<IProduct, 'id'> | null | undefined): Promise<void> {
					if (!product) return;
					const id = String(product.id);
					const adding = !store.saved().has(id);
					const before = store.ids();
					const next = adding ? [id, ...before] : before.filter((saved) => saved !== id);
					// The heart changes at once; a refused write puts it back.
					patchState(store, { ids: next, items: dropCards(next) });
					if (!auth.isAuthenticated()) {
						if (adding && before.length >= WISHLIST_GUEST_LIMIT) {
							patchState(store, { ids: before });
							toastr.error(transloco.translate('wishlist_full'));
							return;
						}
						keepGuest(next);
						say(adding ? 'wishlist_added' : 'wishlist_removed');
						return;
					}
					try {
						const answer = await firstValueFrom(adding ? api.add(id) : api.remove(id));
						patchState(store, { ids: answer.productIds, items: dropCards(answer.productIds) });
						say(adding ? 'wishlist_added' : 'wishlist_removed');
					} catch {
						patchState(store, { ids: before });
						fail();
					}
				},

				/** Cards for the wishlist page: the account's, or the guest cookie's. */
				async loadPage(): Promise<void> {
					patchState(store, { loading: true });
					try {
						if (auth.isAuthenticated()) {
							const { productIds, items } = await firstValueFrom(api.account());
							patchState(store, { ids: productIds, items, owner: 'account' });
						} else {
							const ids = guestIds();
							patchState(store, { ids, items: await firstValueFrom(api.cards(ids)), owner: 'guest' });
						}
					} catch {
						patchState(store, { items: [] });
					} finally {
						patchState(store, { loading: false });
					}
				},
			};
			return methods;
		},
	),
	withHooks({
		onInit(store, platformId = inject(PLATFORM_ID), auth = inject(AuthStore)) {
			if (!isPlatformBrowser(platformId)) return;
			// Follow the session: a sign-in merges the guest list, a sign-out shows the guest's again.
			effect(() => {
				const status = auth.isAuthenticated() ? 'account' : auth.isResolving() ? 'unknown' : 'guest';
				if (status === 'unknown') return;
				untracked(() => void store.sync());
			});
		},
	}),
);
