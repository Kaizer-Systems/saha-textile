import { Component, computed, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { quoteBundle } from '@saha-textile/core-domain/bundle';

import { ResolvedImage, roleSrcset } from '@core/media/resolved-image';
import { IBundle } from '@data-access/interfaces/product-detail.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { setQuote } from '../../set-pricing';

/**
 * A set's summary (product page brief P8; bundle builder brief, approved 2026-11-22): its pieces and extras with
 * their prices today, what they cost bought separately, what the set saves and the set price. On laptops it takes
 * Trending Products' place in the right column of a set page; on phones it sits in the Configure set sheet.
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
	/** The shopper's picks and extras; the set's included pieces until the page reports them. */
	readonly picks = input<Record<string, string[]> | null>(null);
	readonly extras = input<string[] | null>(null);

	private readonly quote = computed(() =>
		quoteBundle(setQuote(this.bundle()), { picks: this.picks() ?? {}, extras: this.extras() ?? [] }),
	);
	private readonly items = computed(
		() =>
			new Map(
				[...this.bundle().levels.flatMap((level) => level.items), ...this.bundle().extras].map((i) => [
					i.key,
					i,
				]),
			),
	);

	readonly lines = computed(() => [
		...this.quote().pieces.map((piece) => ({
			key: piece.key,
			name: this.items().get(piece.key)?.name ?? '',
			quantity: piece.quantity,
			today: piece.todayINR,
			extra: false,
			free: false,
		})),
		...this.quote().extras.map((extra) => ({
			key: extra.key,
			name: this.items().get(extra.key)?.name ?? '',
			quantity: extra.quantity,
			today: extra.todayINR,
			extra: true,
			free: extra.free,
		})),
	]);

	readonly price = computed(() => this.total() ?? this.quote().totalINR);
	readonly separately = computed(() => this.quote().separatelyINR);
	readonly srcset = computed(() => roleSrcset(this.image(), 'card') ?? roleSrcset(this.image(), 'gallery'));
	readonly saving = computed(() => Math.max(0, this.separately() - this.price()));
}
