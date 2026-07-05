import { Component, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IProduct } from '@data-access/interfaces/product.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { PaymentOption } from '../widgets/payment-option/payment-option';
import { ProductAction } from '../widgets/product-action/product-action';
import { ProductBundle } from '../widgets/product-bundle/product-bundle';
import { ProductContain } from '../widgets/product-contain/product-contain';
import { ProductDeliveryInformation } from '../widgets/product-delivery-information/product-delivery-information';
import { ProductDetailsTabs } from '../widgets/product-details-tabs/product-details-tabs';
import { ProductInformation } from '../widgets/product-information/product-information';
import { ProductSocialShare } from '../widgets/product-social-share/product-social-share';

@Component({
  selector: 'app-product-images',
  templateUrl: './product-images.html',
  styleUrls: ['./product-images.scss'],
  imports: [
    ProductContain,
    ProductAction,
    ProductInformation,
    ProductDeliveryInformation,
    PaymentOption,
    ProductSocialShare,
    ProductBundle,
    ProductDetailsTabs,
    TranslateModule,
  ],
})
export class ProductImages {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly product = input<IProduct>();
  readonly option = input<IOption | null>();
}
