import { Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

/** At or under this many left, stock reads "Only N left" in amber: the shop default (owner log, Badges). */
export const LOW_STOCK_AT = 2;

/**
 * The option table (Option / SKU / Stock / Price) for a product with variations: every row
 * server-drawn so search engines read it, the chosen row marked. Informational only; the choosing
 * happens in the size or colour boxes. Its own part so the product page can show it below the
 * buttons (owner, 21 Nov 2026, product page brief P10) while the pop-up keeps it with the choices.
 */
@Component({
	selector: 'app-variation-table',
	templateUrl: './variation-table.html',
	styleUrls: ['./variation-table.scss'],
	providers: [CurrencySymbolPipe],
	imports: [CurrencySymbolPipe, TranslocoModule],
})
export class VariationTable {
	readonly product = input<IProduct>();
	readonly selected = input<IVariation | null>(null);

	readonly lowStock = LOW_STOCK_AT;
}
