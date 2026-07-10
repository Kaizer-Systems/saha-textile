import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { WishlistFacade } from '@core/state/wishlist/wishlist.store';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { NoData } from '@shared/ui/no-data/no-data';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { CartFacade } from '@core/state/cart/cart.facade';

@Component({
  selector: 'app-cart',
  templateUrl: './cart.html',
  styleUrls: ['./cart.scss'],
  providers: [CurrencySymbolPipe],
  imports: [Breadcrumb, RouterLink, Button, NoData, AsyncPipe, CurrencySymbolPipe, TranslateModule],
})
export class Cart {
  private wishlistFacade = inject(WishlistFacade);
  private cartFacade = inject(CartFacade);

  cartItem$: Observable<ICart[]> = this.cartFacade.cartItems$;
  cartTotal$: Observable<number> = this.cartFacade.cartTotal$;

  public breadcrumb: IBreadcrumb = {
    title: 'Cart',
    items: [{ label: 'Cart', active: true }],
  };

  updateQuantity(item: ICart, qty: number) {
    const params: ICartAddOrUpdate = {
      id: item.id,
      product: item.product,
      product_id: item.product.id,
      variation: item.variation,
      variation_id: item?.variation_id ? item?.variation_id : null,
      quantity: qty,
    };
    this.cartFacade.updateCart(params);
  }

  delete(id: number) {
    this.cartFacade.deleteCart(id);
  }

  addToWishlist(id: number) {
    this.wishlistFacade.addToWishlist({ product_id: id });
  }
}
