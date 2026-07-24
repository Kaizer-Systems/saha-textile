import { Component, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { CarouselComponent } from 'ngx-owl-carousel-o';

import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { VariantAttributes } from '@shared/ui/variant-attributes/variant-attributes';

/**
 * `variation_axis` renderer. Each axis changes SKU/stock/price/base identity and
 * generates the `variations[]` matrix. Reuses the shared `variant-attributes`
 * swatch selector (all 6 display styles, API-driven via `attribute.style`) and
 * adds an informational variation table (Option / SKU / Stock / Price) that
 * reflects the current selection — every row server-rendered for crawlability.
 */
@Component({
	selector: 'app-variation-axis',
	templateUrl: './variation-axis.html',
	styleUrls: ['./variation-axis.scss'],
	providers: [CurrencySymbolPipe],
	imports: [VariantAttributes, CurrencySymbolPipe, TranslocoModule],
})
export class VariationAxis {
	readonly product = input<IProduct>();
	readonly owlCar = input<CarouselComponent>();

	readonly selectVariation = output<IVariation | null>();

	public selectedVariation: IVariation | null = null;

	onSelect(variation: IVariation | null) {
		this.selectedVariation = variation;
		this.selectVariation.emit(variation);
	}
}
