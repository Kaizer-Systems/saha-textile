import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, computed, inject } from '@angular/core';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

import { readCookieList, writeCookieList } from '@core/state/lists/session-cookie-list';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';

export const COMPARE_COOKIE = 'st_compare';
export const COMPARE_LIMIT = 4;

interface CompareState {
	/** Product slugs in the order they were added. */
	slugs: string[];
	/** Full product reads for the compare page. */
	items: IProduct[];
	loading: boolean;
}

/**
 * The compare list (owner decision 2026-11-08): up to four products for this browser session,
 * guest or signed in, kept in the `st_compare` session cookie and never stored on the server.
 * The compare page reads each product from the live catalogue, so prices and stock are current.
 */
export const CompareStore = signalStore(
	{ providedIn: 'root' },
	withState<CompareState>({ slugs: [], items: [], loading: false }),
	withComputed((store) => ({
		count: computed(() => store.slugs().length),
		chosen: computed(() => new Set(store.slugs())),
	})),
	withMethods(
		(
			store,
			products = inject(ProductService),
			toastr = inject(ToastrService),
			transloco = inject(TranslocoService),
			document = inject(DOCUMENT),
			platformId = inject(PLATFORM_ID),
		) => {
			const browser = isPlatformBrowser(platformId);
			const keep = (slugs: string[]) => {
				patchState(store, {
					slugs,
					items: store.items().filter((item) => slugs.includes(item.slug)),
				});
				if (browser) document.cookie = writeCookieList(COMPARE_COOKIE, slugs);
			};
			return {
				has(slug: string | undefined): boolean {
					return !!slug && store.chosen().has(slug);
				},

				read(): void {
					if (browser)
						patchState(store, { slugs: readCookieList(document.cookie, COMPARE_COOKIE, COMPARE_LIMIT) });
				},

				toggle(product: Pick<IProduct, 'slug'> | null | undefined): void {
					const slug = product?.slug;
					if (!slug) return;
					if (store.chosen().has(slug)) {
						keep(store.slugs().filter((chosen) => chosen !== slug));
						toastr.success(transloco.translate('compare_removed'));
						return;
					}
					if (store.slugs().length >= COMPARE_LIMIT) {
						toastr.warning(transloco.translate('compare_full', { count: COMPARE_LIMIT }));
						return;
					}
					keep([...store.slugs(), slug]);
					toastr.success(transloco.translate('compare_added'));
				},

				remove(slug: string): void {
					keep(store.slugs().filter((chosen) => chosen !== slug));
				},

				/** Each chosen product from the catalogue; one that left the shop drops out of the list. */
				async loadPage(): Promise<void> {
					const slugs = store.slugs();
					patchState(store, { loading: true });
					const reads = await Promise.all(
						slugs.map((slug) => firstValueFrom(products.getProductPage(slug)).catch(() => null)),
					);
					const items = reads.filter((item): item is IProduct => item !== null);
					keep(items.map((item) => item.slug));
					patchState(store, { items, loading: false });
				},
			};
		},
	),
	withHooks({
		onInit(store) {
			store.read();
		},
	}),
);
