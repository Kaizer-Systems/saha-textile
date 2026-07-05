import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { IProduct, IProductModel } from '@data-access/interfaces/product.interface';
import { ProductState } from '@data-access/states/product.state';

@Component({
  selector: 'app-recent-purchase-popup',
  templateUrl: './recent-purchase-popup.html',
  styleUrls: ['./recent-purchase-popup.scss'],
  imports: [RouterLink, TranslateModule],
})
export class RecentPurchasePopup {
  private platformId = inject<Object>(PLATFORM_ID);

  relatesProduct$: Observable<IProduct[]> = inject(Store).select(ProductState.relatedProducts);
  product$: Observable<IProductModel> = inject(Store).select(ProductState.product);

  public product: IProduct | null;
  public show: boolean = false;
  public min: number = 10;
  public popup_enable: boolean = true;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      if (this.popup_enable) {
        setInterval(() => {
          this.show = true;
          this.min = Math.floor(Math.random() * 60) + 1;
          this.randomlySelectProduct();
          setTimeout(() => {
            this.show = false;
          }, 5000);
        }, 20000);
      }
    }
  }

  randomlySelectProduct() {
    this.product$.subscribe(product => {
      if (!product.data.length) {
        this.relatesProducts();
      } else {
        const randomIndex = Math.floor(Math.random() * product.data.length);
        this.product = product.data[randomIndex];
      }
    });
  }

  relatesProducts() {
    this.relatesProduct$.subscribe(products => {
      const randomIndex = Math.floor(Math.random() * products.length);
      this.product = products[randomIndex];
    });
  }

  closePopup() {
    this.popup_enable = false;
  }
}
