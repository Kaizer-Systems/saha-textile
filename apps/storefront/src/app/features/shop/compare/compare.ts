import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbRating } from '@ng-bootstrap/ng-bootstrap';

import { CompareStore } from '@core/state/compare/compare.store';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

/**
 * The compare page: the theme's compare columns for the products in this session's list, each
 * read from the live catalogue (price, the product's own facts, lengths, stock, rating).
 * Personal, so it is not indexed (see the route).
 */
@Component({
	selector: 'app-compare',
	templateUrl: './compare.html',
	styleUrls: ['./compare.scss'],
	providers: [CurrencySymbolPipe],
	imports: [Breadcrumb, NgbRating, NoData, RouterLink, CurrencySymbolPipe, TranslocoModule],
})
export class Compare {
	readonly compare = inject(CompareStore);

	public breadcrumb = translatedBreadcrumb('compare');

	public skeletonItems = Array.from({ length: 3 }, (_, index) => index);

	/** Every fact any chosen product has, in the order first seen, so each column shows the same rows. */
	readonly factRows = computed(() => {
		const rows = new Map<string, string>();
		for (const product of this.compare.items()) {
			for (const fact of product.semantic_attributes ?? [])
				if (!rows.has(fact.code)) rows.set(fact.code, fact.label);
		}
		return [...rows].map(([code, label]) => ({ code, label }));
	});

	factOf(product: IProduct, code: string): string {
		return product.semantic_attributes?.find((fact) => fact.code === code)?.value || '-';
	}

	/** False until the browser has the list: the server shows the skeleton, never a false "empty". */
	readonly ready = signal(false);

	constructor() {
		if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
		void this.compare.loadPage().then(() => this.ready.set(true));
	}
}
