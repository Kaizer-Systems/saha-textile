import { Component, inject, viewChild, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NgbRatingConfig, NgbRating } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { ICartAddOrUpdate, ICart } from '@data-access/interfaces/cart.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CartFacade } from '@core/state/cart/cart.facade';
import { CompareFacade } from '@core/state/compare/compare.store';
import { WishlistFacade } from '@core/state/wishlist/wishlist.store';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { ProductDetailModal } from '@shared/ui/modal/product-detail-modal/product-detail-modal';
import { Button } from '../../button/button';
import { VariationModal } from '../../modal/variation-modal/variation-modal';

@Component({
  selector: 'app-product-box-horizontal',
  templateUrl: './product-box-horizontal.html',
  styleUrls: ['./product-box-horizontal.scss'],
  providers: [CurrencySymbolPipe],
  imports: [
    RouterLink,
    Button,
    NgbRating,
    ProductDetailModal,
    VariationModal,
    TranslateModule,
    TitleCasePipe,
    CurrencySymbolPipe,
  ],
})
export class ProductBoxHorizontal {
  private wishlistFacade = inject(WishlistFacade);
  private compareFacade = inject(CompareFacade);
  private cartFacade = inject(CartFacade);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly product = input<IProduct>();
  readonly class = input<string>();
  readonly close = input<boolean>();

  cartItem$: Observable<ICart[]> = this.cartFacade.cartItems$;

  readonly productDetailModal = viewChild<ProductDetailModal>('productDetailModal');
  readonly VariationModal = viewChild<VariationModal>('variationModal');

  public cartItem: ICart | null;
  public currentDate: number | null;
  public saleStartDate: number | null;

  constructor() {
    const config = inject(NgbRatingConfig);

    config.max = 5;
    config.readonly = true;
  }

  ngOnInit() {
    this.cartItem$.subscribe(items => {
      this.cartItem = items.find(item => item.product.id == this.product()?.id)!;
    });
  }

  addToCart(product: IProduct, qty: number) {
    const params: ICartAddOrUpdate = {
      id: this.cartItem ? this.cartItem.id : null,
      product: product,
      product_id: product?.id,
      variation_id: this.cartItem ? this.cartItem?.variation_id : null,
      variation: this.cartItem ? this.cartItem?.variation : null,
      quantity: qty,
    };
    this.cartFacade.addToCart(params);
  }

  addToWishlist(id: number) {
    this.wishlistFacade.addToWishlist({ product_id: id });
  }

  removeWishlist(id: number) {
    this.wishlistFacade.deleteWishlist(id);
  }

  addToCompar(id: number) {
    this.compareFacade.addToCompare({ product_id: id });
  }
}
