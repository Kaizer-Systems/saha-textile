import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { NgxImageZoomModule } from 'ngx-image-zoom';
import { CarouselModule } from 'ngx-owl-carousel-o';

import * as data from '../../../../../shared/data/owl-carousel';
import { IProduct } from '@data-access/interfaces/product.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ProductSidebar } from '../sidebar/sidebar';
import { PaymentOption } from '../widgets/payment-option/payment-option';
import { ProductAction } from '../widgets/product-action/product-action';
import { ProductBundle } from '../widgets/product-bundle/product-bundle';
import { ProductContain } from '../widgets/product-contain/product-contain';
import { ProductDeliveryInformation } from '../widgets/product-delivery-information/product-delivery-information';
import { ProductDetailsTabs } from '../widgets/product-details-tabs/product-details-tabs';
import { ProductInformation } from '../widgets/product-information/product-information';
import { ProductSocialShare } from '../widgets/product-social-share/product-social-share';

@Component({
  selector: 'app-product-thumbnail',
  templateUrl: './product-thumbnail.html',
  styleUrls: ['./product-thumbnail.scss'],
  imports: [
    CarouselModule,
    NgxImageZoomModule,
    ProductContain,
    ProductAction,
    ProductInformation,
    ProductDeliveryInformation,
    PaymentOption,
    ProductSocialShare,
    ProductBundle,
    ProductDetailsTabs,
    ProductSidebar,
    TranslateModule,
  ],
})
export class ProductThumbnail {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly product = input<IProduct>();
  readonly option = input<IOption | null>();

  public activeSlide: string = '0';

  public productMainThumbSlider = data.productMainThumbSlider;
  public productThumbSlider = data.productThumbSlider;

  public isBrowser: boolean;

  constructor() {
    const platformId = inject(PLATFORM_ID);

    this.isBrowser = isPlatformBrowser(platformId);
  }
}
