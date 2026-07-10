import { AsyncPipe, NgClass, NgStyle } from '@angular/common';
import { Component, computed, inject, viewChild, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import {
  DeleteCartAction,
  GetCartItemsAction,
  ToggleSidebarCartAction,
  UpdateCartAction,
} from '@data-access/actions/cart.action';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { CartService } from '@data-access/services/cart.service';
import { CartState } from '@data-access/states/cart.state';
import { ThemeOptionState } from '@data-access/states/theme-option.state';
import { SettingStore } from '@core/state/setting.store';
import { Button } from '@shared/ui/button/button';
import { VariationModal } from '@shared/ui/modal/variation-modal/variation-modal';

@Component({
  selector: 'app-header-cart',
  templateUrl: './cart.html',
  styleUrls: ['./cart.scss'],
  providers: [CurrencySymbolPipe],
  imports: [
    Button,
    RouterLink,
    VariationModal,
    AsyncPipe,
    TranslateModule,
    CurrencySymbolPipe,
    NgClass,
    NgStyle
  ],
})
export class Cart {
  private store = inject(Store);
  private settingStore = inject(SettingStore);
  cartService = inject(CartService);

  cartItem$: Observable<ICart[]> = inject(Store).select(CartState.cartItems);
  cartTotal$: Observable<number> = inject(Store).select(CartState.cartTotal);
  sidebarCartOpen$: Observable<boolean> = inject(Store).select(CartState.sidebarCartOpen);
  themeOption$: Observable<IOption> = inject(Store).select(
    ThemeOptionState.themeOptions,
  ) as Observable<IOption>;
  setting$: Observable<IValues> = toObservable(this.settingStore.setting) as Observable<IValues>;

  readonly VariationModal = viewChild<VariationModal>('variationModal');

  readonly style = input<string>('basic');

  public cartStyle: string = 'cart_sidebar';
  public shippingFreeAmt: number = 0;
  public cartTotal: number = 0;
  public shippingCal: number = 0;
  public confettiItems = Array.from({ length: 150 }, (_, index) => index);
  public confetti: number = 0;
  public loader: boolean = false;

  constructor() {
    this.store.dispatch(new GetCartItemsAction());
    this.themeOption$.subscribe(option => (this.cartStyle = option?.general?.cart_style));

    // Calculation
    this.cartTotal$.subscribe(total => {
      this.setting$.subscribe(
        setting => (this.shippingFreeAmt = setting?.general?.min_order_free_shipping),
      );
      this.cartTotal = total;
      this.shippingCal = (this.cartTotal * 100) / this.shippingFreeAmt;
      if (this.shippingCal > 100) {
        this.shippingCal = 100;
        if (this.confetti == 0) {
          this.confetti = 1;
          setTimeout(() => {
            this.confetti = 2;
          }, 4500);
        }
      } else {
        this.confetti = 0;
      }
    });
  }

  cartToggle(value: boolean) {
    this.store.dispatch(new ToggleSidebarCartAction(value));
  }

  updateQuantity(item: ICart, qty: number) {
    const params: ICartAddOrUpdate = {
      id: item?.id,
      product_id: item?.product?.id,
      product: item?.product ? item?.product : null,
      variation_id: item?.variation_id ? item?.variation_id : null,
      variation: item?.variation ? item?.variation : null,
      quantity: qty,
    };
    this.store.dispatch(new UpdateCartAction(params));
  }

  delete(id: number) {
    this.store.dispatch(new DeleteCartAction(id));
  }
}
