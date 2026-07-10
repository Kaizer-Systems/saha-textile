import { Component, computed, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { Button } from '@shared/ui/button/button';
import { injectRelatedProductsData } from '@data-access/queries/product.queries';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { CartFacade } from '@core/state/cart/cart.facade';

@Component({
  selector: 'app-product-bundle',
  templateUrl: './product-bundle.html',
  styleUrls: ['./product-bundle.scss'],
  providers: [CurrencySymbolPipe],
  imports: [RouterLink, Button, CurrencySymbolPipe, TranslateModule],
})
export class ProductBundle {
  private cartFacade = inject(CartFacade);

  private readonly relatedQuery = injectRelatedProductsData();
  crossSellproduct$: Observable<IProduct[]> = toObservable(
    computed(() => this.relatedQuery.data() ?? []),
  );
  cartItem$: Observable<ICart[]> = this.cartFacade.cartItems$;

  readonly product = input<IProduct | null>();

  public cartItem: ICart | null;

  public crossSellproducts: IProduct[] = [];
  public selectedProduct: IProduct[] = [];
  public selectedProductIds: number[] = [];

  public total: number = 0;

  ngOnChanges() {
    const productValue = this.product();
    if (productValue?.cross_sell_products && Array.isArray(productValue?.cross_sell_products)) {
      this.crossSellproduct$.subscribe(products => {
        this.crossSellproducts = products.filter(product =>
          this.product()?.cross_sell_products?.includes(product?.id!),
        );
      });
    }
  }

  select(event: Event) {
    const index = this.selectedProductIds.indexOf(Number((<HTMLInputElement>event?.target)?.value)); // checked and unchecked value
    if ((<HTMLInputElement>event?.target)?.checked)
      this.selectedProductIds.push(Number((<HTMLInputElement>event?.target)?.value)); // push in array cheked value
    else this.selectedProductIds.splice(index, 1); // removed in array unchecked value

    this.crossSellproduct$.subscribe(products => {
      this.selectedProduct = products.filter(product =>
        this.selectedProductIds?.includes(product?.id!),
      );
    });

    this.total = this.selectedProduct.reduce((sum, item) => sum + item.sale_price, 0);
  }

  addToCartAll() {
    this.selectedProduct.forEach(product => {
      if (product) {
        this.cartItem$.subscribe(items => {
          this.cartItem = items.find(item => item.product.id == product.id)!;
        });
        const params: ICartAddOrUpdate = {
          id: this.cartItem ? this.cartItem.id : null,
          product_id: product?.id!,
          product: product ? product : null,
          variation: null,
          variation_id: null,
          quantity: 1,
        };
        this.cartFacade.addToCart(params);
      }
    });
  }
}
