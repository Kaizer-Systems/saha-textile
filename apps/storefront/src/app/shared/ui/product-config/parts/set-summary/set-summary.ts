import { Component, computed, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { chosenPieces } from '@saha-textile/core-domain/set-price';

import { ResolvedImage, roleSrcset } from '@core/media/resolved-image';
import { IBundle } from '@data-access/interfaces/product-detail.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { setPricing } from '../../set-pricing';

/**
 * A set's summary (owner, 21 Nov 2026, product page brief P8): its pieces with their prices, what they cost bought
 * separately, what the set saves and the set price. On laptops it takes Trending Products' place in the right column
 * of a set page; on phones it sits in the Configure set sheet.
 */
@Component({
	selector: 'app-set-summary',
	templateUrl: './set-summary.html',
	providers: [CurrencySymbolPipe],
	imports: [CurrencySymbolPipe, TranslocoModule],
})
export class SetSummary {
	readonly bundle = input.required<IBundle>();
	/** The set price with any chosen options; the set's own price when not given. */
	readonly total = input<number | null>(null);
	/** The set's own name and photo, and how many sets the page will add. */
	readonly name = input('');
	readonly photo = input<string | null>(null);
	/** The photo's files, so the browser loads a small one for the 56 px picture. */
	readonly image = input<ResolvedImage | null>(null);
	readonly quantity = input(1);
	/** False while the set cannot be bought (sets wait for their pricing, brief B12): the summary says so. */
	readonly buyable = input(true);
	/** The pieces the set holds now; the set's own pieces until the page reports its picks. */
	readonly chosen = input<string[] | null>(null);

	readonly pieces = computed(() => {
		const ids = new Set(this.chosen() ?? chosenPieces(setPricing(this.bundle())));
		return this.bundle().components.filter((piece) => ids.has(piece.code));
	});

	readonly price = computed(() => this.total() ?? this.bundle().bundle_price);
	readonly separately = computed(() =>
		this.pieces().reduce((sum, piece) => sum + piece.price * (piece.quantity || 1), 0),
	);
	readonly srcset = computed(() => roleSrcset(this.image(), 'card') ?? roleSrcset(this.image(), 'gallery'));
	readonly saving = computed(() => Math.max(0, this.separately() - this.price()));
}
