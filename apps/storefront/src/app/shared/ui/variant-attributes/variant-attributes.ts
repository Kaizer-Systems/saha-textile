import { Component, input, Input, output, SimpleChanges } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbTooltip } from '@ng-bootstrap/ng-bootstrap';
import { CarouselComponent } from 'ngx-owl-carousel-o';

import { IAttribute, IAttributeValue } from '@data-access/interfaces/attribute.interface';
import { IProduct, ISelectedVariant, IVariation } from '@data-access/interfaces/product.interface';

import { Button } from '../button/button';

@Component({
	selector: 'app-variant-attributes',
	templateUrl: './variant-attributes.html',
	styleUrls: ['./variant-attributes.scss'],
	imports: [ReactiveFormsModule, NgbTooltip, Button, TranslocoModule],
})
export class VariantAttributes {
	@Input() product: IProduct;
	@Input() attributes: IAttribute[] = [];

	readonly isAllVariantStyleDropdown = input<boolean>(false);
	readonly owlCar = input<CarouselComponent>();

	readonly selectVariation = output<IVariation | null>();

	public productQty: number = 1;
	public attributeValues: number[] = [];
	public variantIds: number[] = [];
	public soldOutAttributesIds: number[] = [];
	public selectedOptions: ISelectedVariant[] = [];
	public selectedVariation: IVariation | null;

	ngOnChanges(changes: SimpleChanges) {
		setTimeout(() => {
			if (changes['product'] && changes['product'].currentValue) {
				this.product = changes['product']?.currentValue;
			}

			if (changes['attributes'] && changes['attributes'].currentValue) {
				this.attributes = changes['attributes']?.currentValue;
			}

			this.checkVariantAvailability(this.product);
		}, 0);
	}

	checkVariantAvailability(product: IProduct | undefined) {
		if (!product) return;
		this.selectedOptions = [];
		this.attributeValues = [];
		this.selectedVariation = null;

		product?.variations?.forEach((variation) => {
			variation?.attribute_values?.filter((attribute_value) => {
				if (this.attributeValues.indexOf(attribute_value?.id) === -1)
					this.attributeValues.push(attribute_value?.id);
			});
		});

		// The SKU the server chose (the default, or `?variant=`) opens selected, so the
		// first browser render matches the server's even when the cart holds another.
		const opening = product?.variations?.find((variation) => variation.sku === product.sku);
		if (opening) {
			opening.attribute_values?.forEach((attribute_val) => this.setVariant(product.variations, attribute_val));
		}

		if (!opening) {
			// Set First Vatriant Default
			for (const attribute of product?.attributes ?? []) {
				if (this.attributeValues.length && attribute?.attribute_values.length) {
					for (const value of attribute.attribute_values) {
						if (this.attributeValues.includes(value.id)) {
							this.setVariant(product.variations, value);
							break; // Break out of the inner loop after setting the first variant
						}
					}
				}
			}
		}

		// Set Variation Image
		product?.variations?.forEach((variation) => {
			const attrValues = (variation?.attribute_values ?? []).map((attribute_value) => attribute_value?.id);
			(product?.attributes ?? []).forEach((attribute) => {
				if (attribute.style !== 'image') return;
				attribute.attribute_values.forEach((attribute_value) => {
					// A term with its own square swatch keeps it; otherwise it shows the variant's photo.
					if (attribute_value.variation_image) return;
					if (this.attributeValues.includes(attribute_value.id) && attrValues.includes(attribute_value.id)) {
						attribute_value.variation_image = variation.variation_image;
					}
				});
			});
		});
	}

	setVariant(variations: IVariation[], value: IAttributeValue) {
		const index = this.selectedOptions.findIndex(
			(item) => Number(item.attribute_id) === Number(value?.attribute_id),
		);
		this.soldOutAttributesIds = [];
		if (index === -1) {
			this.selectedOptions.push({
				id: Number(value?.id),
				attribute_id: Number(value?.attribute_id),
			});
		} else {
			this.selectedOptions[index].id = value?.id;
		}
		variations?.forEach((variation) => {
			let attrValues = variation?.attribute_values?.map((attribute_value) => attribute_value?.id);
			this.variantIds = this.selectedOptions?.map((variants) => variants?.id);
			let doValuesMatch =
				attrValues.length === this.selectedOptions.length &&
				attrValues.every((value) => this.variantIds.includes(value));
			if (doValuesMatch) {
				this.selectedVariation = variation;
				this.product['quantity'] = variation.quantity;
				this.product['sku'] = variation.sku;
				const owlCar = this.owlCar();
				if (owlCar && this.selectedVariation.variation_image) {
					owlCar.to(this.selectedVariation.variation_image.id.toString());
				}
				this.checkStockAvailable();
			}

			if (variation.stock_status == 'out_of_stock') {
				variation?.attribute_values.filter((attr_value) => {
					if (attrValues.some((value) => this.variantIds.includes(value))) {
						if (attrValues.every((value) => this.variantIds.includes(value))) {
							this.soldOutAttributesIds.push(attr_value.id);
						} else if (!this.variantIds.includes(attr_value.id)) {
							this.soldOutAttributesIds.push(attr_value.id);
						}
					} else if (attrValues.length == 1 && attrValues.includes(attr_value.id)) {
						this.soldOutAttributesIds.push(attr_value.id);
					}
				});
			}
		});

		// Set Attribute Value
		this.product.attributes.filter((attribute) => {
			attribute.attribute_values.filter((a_value) => {
				if (a_value.id == value.id) {
					attribute.selected_value = a_value.value;
				}
			});
		});

		this.selectVariation.emit(this.selectedVariation);
	}

	checkStockAvailable() {
		if (this.selectedVariation) {
			this.selectedVariation['stock_status'] =
				this.selectedVariation?.quantity < this.productQty ? 'out_of_stock' : 'in_stock';
		} else {
			this.product['stock_status'] = this.product?.quantity < this.productQty ? 'out_of_stock' : 'in_stock';
		}
	}
}
