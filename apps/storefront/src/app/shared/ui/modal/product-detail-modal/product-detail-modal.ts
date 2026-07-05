import { isPlatformBrowser } from '@angular/common';
import { Component, TemplateRef, PLATFORM_ID, inject, viewChild, input } from '@angular/core';

import { ModalDismissReasons, NgbModal, NgbRating } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { CarouselModule } from 'ngx-owl-carousel-o';
import { Observable } from 'rxjs';

import * as data from '@shared/data/owl-carousel';
import { AddToCartAction } from '@data-access/actions/cart.action';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { CartState } from '@data-access/states/cart.state';
import { Button } from '../../button/button';
import { VariantAttributes } from '../../variant-attributes/variant-attributes';

@Component({
  selector: 'app-product-detail-modal',
  templateUrl: './product-detail-modal.html',
  styleUrls: ['./product-detail-modal.scss'],
  providers: [CurrencySymbolPipe],
  imports: [
    Button,
    CarouselModule,
    NgbRating,
    VariantAttributes,
    TranslateModule,
    TitleCasePipe,
    CurrencySymbolPipe,
  ],
})
export class ProductDetailModal {
  private modalService = inject(NgbModal);
  private platformId = inject<Object>(PLATFORM_ID);
  private store = inject(Store);

  readonly productDetailModal = viewChild<TemplateRef<IProduct>>('productDetailModal');

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly product = input<IProduct>();

  cartItem$: Observable<ICart[]> = inject(Store).select(CartState.cartItems) as Observable<ICart[]>;

  public closeResult: string;
  public modalOpen: boolean = false;

  public cartItem: ICart | null;
  public productQty: number = 1;
  public selectedVariation: IVariation | null;

  public activeSlide: string = '0';

  public productMainThumbSlider = data.productMainThumbSlider;
  public productThumbSlider = data.productThumbSlider;
  public isBrowser: boolean;

  constructor() {
    const platformId = this.platformId;

    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit() {
    this.cartItem$.subscribe(items => {
      this.cartItem = items.find(item => item.product.id == this.product()!.id)!;
    });
  }

  async openModal() {
    if (isPlatformBrowser(this.platformId)) {
      this.modalOpen = true;
      this.modalService
        .open(this.productDetailModal(), {
          ariaLabelledBy: 'IProduct-Detail-Modal',
          centered: true,
          windowClass: 'theme-modal view-modal modal-lg',
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
      this.product()!['stock_status'] =
        this.product()!.quantity < this.productQty ? 'out_of_stock' : 'in_stock';
    }
  }

  addToCart(product: IProduct) {
    if (product) {
      const params: ICartAddOrUpdate = {
        id:
          this.cartItem &&
          this.selectedVariation &&
          this.cartItem?.variation &&
          this.selectedVariation?.id == this.cartItem?.variation?.id
            ? this.cartItem.id
            : null,
        product_id: product?.id!,
        product: product ? product : null,
        variation: this.selectedVariation ? this.selectedVariation : null,
        variation_id: this.selectedVariation?.id ? this.selectedVariation?.id! : null,
        quantity: this.productQty,
      };
      this.store.dispatch(new AddToCartAction(params)).subscribe({
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
