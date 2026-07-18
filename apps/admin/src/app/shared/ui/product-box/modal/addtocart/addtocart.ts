import { Component, TemplateRef, inject, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Store } from '@ngrx/store';

import { CartActions } from '@core/state/cart/cart.actions';
import { IAttributeValue } from '@data-access/interfaces/attribute.interface';
import { ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { IProduct, IVariation, ISelectedVariant } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { SummaryPipe } from '@shared/pipes/summary.pipe';

import { Button } from '../../../button/button';

@Component({
	selector: 'app-addtocart',
	templateUrl: './addtocart.html',
	styleUrls: ['./addtocart.scss'],
	imports: [Button, TranslocoModule, CurrencySymbolPipe, SummaryPipe],
})
export class Addtocart {
	private modalService = inject(NgbModal);
	private store = inject(Store);

	public modalOpen: boolean = false;
	public closeResult: string;
	public product: IProduct;
	public productQty: number = 1;

	public attributeValues: number[] = [];
	public variantIds: number[] = [];
	public selectedOptions: ISelectedVariant[] = [];

	public selectedVariation: IVariation;

	readonly addToCartModal = viewChild<TemplateRef<string>>('addToCartModal');

	async openModal(product: IProduct) {
		this.checkVariantAvailability(product);
		this.product = product;
		this.modalOpen = true;
		this.modalService
			.open(this.addToCartModal(), {
				ariaLabelledBy: 'AddToCartModal',
				centered: true,
				windowClass: 'theme-modal modal-lg',
			})
			.result.then(
				(result) => {
					`Result ${result}`;
					this.closeResult = `Closed with: ${result}`;
				},
				(reason) => {
					this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
				},
			);
	}

	checkVariantAvailability(product: IProduct) {
		product?.variations?.forEach((variation) => {
			variation?.attribute_values?.filter((attribute_value) => {
				if (this.attributeValues.indexOf(attribute_value?.id!) === -1)
					this.attributeValues.push(attribute_value?.id!);
			});
		});
	}

	setVariant(variations: IVariation[], value: IAttributeValue) {
		const index = this.selectedOptions.findIndex(
			(item) => Number(item.attribute_id) === Number(value?.attribute_id),
		);
		if (index === -1) {
			this.selectedOptions.push({
				id: Number(value?.id)!,
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
				attrValues.every((value) => this.variantIds.includes(value!));
			if (doValuesMatch) {
				this.selectedVariation = variation;
				this.checkStockAvailable();
			}
		});
	}

	updateQuantity(qty: number) {
		if (1 > this.productQty + qty) return;
		this.productQty = this.productQty + qty;
		this.checkStockAvailable();
	}

	checkStockAvailable() {
		if (this.selectedVariation) {
			this.selectedVariation['stock_status'] =
				this.selectedVariation?.quantity < this.productQty ? 'out_of_stock' : 'in_stock';
		}
	}

	addToCart(product: IProduct) {
		if (this.selectedVariation) {
			const params: ICartAddOrUpdate = {
				id: null,
				product_id: product?.id!,
				product: product,
				variation: this.selectedVariation,
				variation_id: this.selectedVariation?.id!,
				quantity: this.productQty,
			};
			this.store.dispatch(CartActions.addToCart({ payload: params }));
			this.modalService.dismissAll();
		}
	}

	private getDismissReason(reason: ModalDismissReasons): string {
		if (reason === ModalDismissReasons.ESC) {
			return 'by pressing ESC';
		} else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
			return 'by clicking on a backdrop';
		} else {
			return `with: ${reason}`;
		}
	}
}
