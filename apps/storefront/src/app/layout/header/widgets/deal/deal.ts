import { Component, SimpleChanges, inject, input, viewChild } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetDealProductsAction } from '@data-access/actions/product.action';
import { IProduct } from '@data-access/interfaces/product.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ProductState } from '@data-access/states/product.state';
import { Button } from '@shared/ui/button/button';
import { DealsModal } from '@shared/ui/modal/deals-modal/deals-modal';

@Component({
  selector: 'app-deal',
  imports: [Button, DealsModal, TranslateModule],
  templateUrl: './deal.html',
  styleUrls: ['./deal.scss'],
})
export class Deal {
  private store = inject(Store);

  readonly style = input<string>('basic');
  readonly data = input<IOption | null>();

  readonly DealsModal = viewChild<DealsModal>('dealsModal');

  dealProducts$: Observable<IProduct[]> = inject(Store).select(
    ProductState.dealProducts,
  ) as Observable<IProduct[]>;

  public dealProducts: IProduct[];
  public ids: number[];

  ngOnChanges(changes: SimpleChanges) {
    this.ids = changes['data']?.currentValue?.header?.today_deals;
  }

  ngOnInit() {
    if (Array.isArray(this.ids)) {
      this.store.dispatch(new GetDealProductsAction({ ids: this.ids.join() })).subscribe({
        next: (val: any) => {
          this.dealProducts = val?.product?.dealProducts;
        },
      });
    }
  }
}
