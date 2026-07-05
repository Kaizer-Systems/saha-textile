import { AsyncPipe, SlicePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { ICart } from '@data-access/interfaces/cart.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { CartState } from '@data-access/states/cart.state';
import { Button } from '../button/button';

@Component({
  selector: 'app-sticky-cart',
  templateUrl: './sticky-cart.html',
  styleUrls: ['./sticky-cart.scss'],
  providers: [CurrencySymbolPipe],
  imports: [Button, RouterLink, AsyncPipe, SlicePipe, TranslateModule, CurrencySymbolPipe],
})
export class StickyCart {
  cartItem$: Observable<ICart[]> = inject(Store).select(CartState.cartItems);
  cartTotal$: Observable<number> = inject(Store).select(CartState.cartTotal);
  stickyCart$: Observable<boolean> = inject(Store).select(CartState.stickyCart);

  public isOpen: boolean;

  constructor() {
    this.stickyCart$.subscribe(value => (this.isOpen = value));
  }

  openCart(isOpen: boolean) {
    this.isOpen = isOpen;
  }
}
