import { AsyncPipe, NgClass, NgStyle } from '@angular/common';
import { Component, computed, inject, viewChild, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { CartService } from '@data-access/services/cart.service';
import { CartFacade } from '@core/state/cart/cart.facade';
import { ThemeOptionStore } from '@core/state/theme-option.store';
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
  private cartFacade = inject(CartFacade);
  private settingStore = inject(SettingStore);
  cartService = inject(CartService);

  cartItem$: Observable<ICart[]> = this.cartFacade.cartItems$;
  cartTotal$: Observable<number> = this.cartFacade.cartTotal$;
  sidebarCartOpen$: Observable<boolean> = this.cartFacade.sidebarCartOpen$;
  themeOption$: Observable<IOption> = toObservable(inject(ThemeOptionStore).themeOptions) as Observable<IOption>;
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
    this.cartFacade.getCartItems();
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
    this.cartFacade.toggleSidebarCart(value);
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
    this.cartFacade.updateCart(params);
  }

  delete(id: number) {
    this.cartFacade.deleteCart(id);
  }
}
