import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { DeleteCartAction, UpdateCartAction } from '@data-access/actions/cart.action';
import { AddToWishlistAction } from '@data-access/actions/wishlist.action';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { NoData } from '@shared/ui/no-data/no-data';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { CartState } from '@data-access/states/cart.state';

@Component({
  selector: 'app-cart',
  templateUrl: './cart.html',
  styleUrls: ['./cart.scss'],
  providers: [CurrencySymbolPipe],
  imports: [Breadcrumb, RouterLink, Button, NoData, AsyncPipe, CurrencySymbolPipe, TranslateModule],
})
export class Cart {
  private store = inject(Store);

  cartItem$: Observable<ICart[]> = inject(Store).select(CartState.cartItems);
  cartTotal$: Observable<number> = inject(Store).select(CartState.cartTotal);

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
    this.store.dispatch(new UpdateCartAction(params));
  }

  delete(id: number) {
    this.store.dispatch(new DeleteCartAction(id));
  }

  addToWishlist(id: number) {
    this.store.dispatch(new AddToWishlistAction({ product_id: id }));
  }
}
