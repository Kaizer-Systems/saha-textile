
import { Component, computed, inject, input, SimpleChanges, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { NgbRating, NgbRatingConfig } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { CarouselModule } from 'ngx-owl-carousel-o';
import { Observable } from 'rxjs';

import { AddToCompareAction } from '@data-access/actions/compare.action';
import { AddToWishlistAction } from '@data-access/actions/wishlist.action';
import { ProductDetailModal } from '@shared/ui/modal/product-detail-modal/product-detail-modal';
import * as data from '../../../../shared/data/owl-carousel';
import { injectProductsQuery } from '@data-access/queries/product.queries';
import { IProductModel } from '@data-access/interfaces/product.interface';
import { IDeal, IDealOfDays } from '@data-access/interfaces/theme.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

@Component({
  selector: 'app-deal',
  templateUrl: './deal.html',
  styleUrls: ['./deal.scss'],
  providers: [CurrencySymbolPipe],
  imports: [CarouselModule, NgbRating, CurrencySymbolPipe, TranslateModule],
})
export class Deal {
  config = inject(NgbRatingConfig);
  private store = inject(Store);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<IDealOfDays>();

  private readonly productsQuery = injectProductsQuery(() => undefined);
  product$: Observable<IProductModel | undefined> = toObservable(
    computed(() => this.productsQuery.data()),
  );

  readonly productDetailModal = viewChild<ProductDetailModal>('productDetailModal');

  public dealSlider = data.singleSlider;
  public deals: IDeal[] = [];

  constructor() {
    const config = this.config;

    config.max = 5;
    config.readonly = true;
  }

  ngOnChanges(changes: SimpleChanges) {
    let dealsArray = changes['data']?.currentValue?.deals;
    this.product$.subscribe(products => {
      dealsArray.map((deal: any) => {
        deal.product = products?.data?.find(product => product.id === deal.product_id);
      });
      this.deals = dealsArray;
      this.startTimers();
    });
  }

  startTimers() {
    for (let counterItem of this.deals) {
      const endDate = new Date(counterItem.end_date).getTime();
      const currentTime = new Date().getTime();
      const timeDifference = endDate - currentTime;

      if (timeDifference > 0) {
        counterItem.remainingTime = this.calculateRemainingTime(timeDifference);
        setInterval(() => {
          counterItem.remainingTime = this.calculateRemainingTime(endDate - new Date().getTime());
        }, 1000);
      }
    }
  }

  calculateRemainingTime(timeDifference: number) {
    const days = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeDifference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeDifference % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeDifference % (1000 * 60)) / 1000);
    return { days, hours, minutes, seconds };
  }

  addToWishlist(id: number) {
    this.store.dispatch(new AddToWishlistAction({ product_id: id }));
  }

  addToCompare(id: number) {
    this.store.dispatch(new AddToCompareAction({ product_id: id }));
  }
}
