import { Component, input, output, viewChild } from '@angular/core';

import { CarouselComponent } from 'ngx-owl-carousel-o';

import { IAttributeValue } from '@data-access/interfaces/attribute.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { VariantAttributes } from '@shared/ui/variant-attributes/variant-attributes';

import { VariationTable } from '../variation-table/variation-table';

/**
 * `variation_axis` renderer. Each axis changes SKU/stock/price/base identity and
 * generates the `variations[]` matrix. Reuses the shared `variant-attributes`
 * swatch selector (all display styles, API-driven via `attribute.style`) and,
 * unless the host places it elsewhere (`showTable`), the informational option
 * table that reflects the current selection.
 */
@Component({
	selector: 'app-variation-axis',
	templateUrl: './variation-axis.html',
	imports: [VariantAttributes, VariationTable],
})
export class VariationAxis {
	readonly product = input<IProduct>();
	readonly owlCar = input<CarouselComponent>();
	/** The product page draws the table below its buttons instead (brief P10); the pop-up keeps it here. */
	readonly showTable = input(true);

	readonly selectVariation = output<IVariation | null>();

	public selectedVariation: IVariation | null = null;

	private readonly picker = viewChild(VariantAttributes);

	/** Chooses a value as if its own button were tapped (the buy bar's chips, brief P4). */
	choose(value: IAttributeValue) {
		const picker = this.picker();
		const variations = this.product()?.variations;
		if (picker && variations) picker.setVariant(variations, value);
	}

	onSelect(variation: IVariation | null) {
		this.selectedVariation = variation;
		this.selectVariation.emit(variation);
	}
}
