import { Component, inject, Input, SimpleChanges } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { Button } from '@shared/ui/button/button';
import { VariantAttributes } from '@shared/ui/variant-attributes/variant-attributes';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { CartFacade } from '@core/state/cart/cart.facade';

@Component({
  selector: 'app-sticky-checkout',
  templateUrl: './sticky-checkout.html',
  styleUrls: ['./sticky-checkout.scss'],
  providers: [CurrencySymbolPipe],
  imports: [VariantAttributes, Button, CurrencySymbolPipe, TranslateModule],
})
export class StickyCheckout {
  private cartFacade = inject(CartFacade);

  @Input() product: IProduct;

  cartItem$: Observable<ICart[]> = this.cartFacade.cartItems$;

  public cartItem: ICart | null;
  public productQty: number = 1;
  public selectedVariation: IVariation | null;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['product'] && changes['product'].currentValue) {
      this.product = changes['product']?.currentValue;
    }
    this.cartItem$.subscribe(items => {
      this.cartItem = items.find(item => item.product.id == this.product.id)!;
    });
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
        this.product.quantity < this.productQty ? 'out_of_stock' : 'in_stock';
    }
  }

  addToCart(product: IProduct) {
    if (product) {
      const params: ICartAddOrUpdate = {
        id: this.cartItem ? this.cartItem.id : null,
        product_id: product?.id!,
        product: product ? product : null,
        variation: this.selectedVariation ? this.selectedVariation : null,
        variation_id: this.selectedVariation?.id ? this.selectedVariation?.id! : null,
        quantity: this.productQty,
      };
      this.cartFacade.addToCart(params);
    }
  }
}
