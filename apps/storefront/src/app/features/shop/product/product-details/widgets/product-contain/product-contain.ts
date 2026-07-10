import { isPlatformBrowser } from '@angular/common';
import { Component, inject, input, Input, PLATFORM_ID, SimpleChanges } from '@angular/core';
import { Router } from '@angular/router';

import { NgbRating } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { CarouselComponent } from 'ngx-owl-carousel-o';
import { Observable } from 'rxjs';

import { CompareFacade } from '@core/state/compare/compare.store';
import { WishlistFacade } from '@core/state/wishlist/wishlist.store';
import { Button } from '@shared/ui/button/button';
import { VariantAttributes } from '@shared/ui/variant-attributes/variant-attributes';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { CartFacade } from '@core/state/cart/cart.facade';
import { SaleTimer } from '../sale-timer/sale-timer';

@Component({
  selector: 'app-product-contain',
  templateUrl: './product-contain.html',
  styleUrls: ['./product-contain.scss'],
  providers: [CurrencySymbolPipe],
  imports: [NgbRating, VariantAttributes, SaleTimer, Button, CurrencySymbolPipe, TranslateModule],
})
export class ProductContain {
  private wishlistFacade = inject(WishlistFacade);
  private compareFacade = inject(CompareFacade);
  private cartFacade = inject(CartFacade);
  private router = inject(Router);

  @Input() product: IProduct;

  @Input() option: IOption | null;

  readonly owlCar = input<CarouselComponent>();

  cartItem$: Observable<ICart[]> = this.cartFacade.cartItems$;

  public cartItem: ICart | null;
  public productQty: number = 1;
  public selectedVariation: IVariation | null;

  public ordersCount: number = 10;
  public viewsCount: number = 30;

  public countsInterval: ReturnType<typeof setInterval>;
  public isBrowser: boolean;

  constructor() {
    const platformId = inject(PLATFORM_ID);

    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnChanges(changes: SimpleChanges) {
    this.selectedVariation = null;

    if (changes['product'] && changes['product'].currentValue) {
      this.product = changes['product']?.currentValue;
    }

    this.countsInterval = setInterval(() => {
      const option = this.option;
      let encourage_max_view_count = option?.product?.encourage_max_view_count
        ? option?.product?.encourage_max_view_count
        : 100;
      this.viewsCount = Math.floor(Math.random() * encourage_max_view_count) + 1;
    }, 5000);

    this.countsInterval = setInterval(() => {
      const option = this.option;
      let encourage_max_order_count = option?.product?.encourage_max_order_count
        ? option?.product?.encourage_max_order_count
        : 100;
      this.ordersCount = Math.floor(Math.random() * encourage_max_order_count) + 1;
    }, 60000);

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
        product_id: product?.id,
        product: product ? product : null,
        variation: this.selectedVariation ? this.selectedVariation : null,
        variation_id: this.selectedVariation?.id ? this.selectedVariation?.id! : null,
        quantity: this.productQty,
      };
      this.cartFacade.addToCart(params);
    }
  }

  buyNow(product: IProduct) {
    if (product) {
      const params: ICartAddOrUpdate = {
        id: this.cartItem ? this.cartItem.id : null,
        product_id: product?.id,
        product: product ? product : null,
        variation: this.selectedVariation ? this.selectedVariation : null,
        variation_id: this.selectedVariation?.id ? this.selectedVariation?.id! : null,
        quantity: this.productQty,
      };
      this.cartFacade.addToCart(params);
      void this.router.navigate(['/checkout']);
    }
  }

  addToWishlist(id: number) {
    this.wishlistFacade.addToWishlist({ product_id: id });
  }

  addToCompare(id: number) {
    this.compareFacade.addToCompare({ product_id: id });
  }

  ngOnDestroy() {
    // Clear the interval when the component is destroyed
    if (this.countsInterval) {
      clearInterval(this.countsInterval);
    }
  }
}
