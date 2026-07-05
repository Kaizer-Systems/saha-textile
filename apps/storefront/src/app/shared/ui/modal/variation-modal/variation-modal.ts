import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, TemplateRef, inject, viewChild } from '@angular/core';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';

import { ReplaceCartAction } from '@data-access/actions/cart.action';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '../../button/button';
import { VariantAttributes } from '../../variant-attributes/variant-attributes';

@Component({
  selector: 'app-variation-modal',
  templateUrl: './variation-modal.html',
  styleUrls: ['./variation-modal.scss'],
  providers: [CurrencySymbolPipe],
  imports: [Button, VariantAttributes, TranslateModule, CurrencySymbolPipe],
})
export class VariationModal {
  private modalService = inject(NgbModal);
  private platformId = inject<Object>(PLATFORM_ID);
  private store = inject(Store);

  readonly VariationModal = viewChild<TemplateRef<string>>('variationModal');

  public closeResult: string;
  public modalOpen: boolean = false;
  public item: ICart;

  public product: IProduct;
  public productQty: number = 1;
  public selectedVariation: IVariation | null;

  async openModal(item: ICart) {
    if (isPlatformBrowser(this.platformId)) {
      this.item = item;
      this.product = item.product;
      this.productQty = item.quantity;
      this.modalOpen = true;
      this.modalService
        .open(this.VariationModal(), {
          ariaLabelledBy: 'variation-Modal',
          centered: true,
          windowClass: 'theme-modal modal-md variation-modal',
        })
        .result.then(
          result => {
            `Result ${result}`;
          },
          reason => {
            this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
          },
        );
    }
  }

  selectVariation(variation: IVariation) {
    this.selectedVariation = variation;
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
    } else {
      this.product['stock_status'] =
        this.product?.quantity < this.productQty ? 'out_of_stock' : 'in_stock';
    }
  }

  replaceCart(product: IProduct) {
    if (product && this.item) {
      const params: ICartAddOrUpdate = {
        id: this.item.id,
        product_id: product?.id,
        product: product ? product : null,
        variation: this.selectedVariation ? this.selectedVariation : null,
        variation_id: this.selectedVariation ? this.selectedVariation.id : null,
        quantity: this.productQty,
      };

      this.store.dispatch(new ReplaceCartAction(params)).subscribe({
        complete: () => {
          this.modalService.dismissAll();
        },
      });
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
