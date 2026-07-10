import { Component, computed, effect, input, viewChild } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { injectDealProductsQuery } from '@data-access/queries/product.queries';
import { IProduct } from '@data-access/interfaces/product.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { Button } from '@shared/ui/button/button';
import { DealsModal } from '@shared/ui/modal/deals-modal/deals-modal';

@Component({
  selector: 'app-deal',
  imports: [Button, DealsModal, TranslateModule],
  templateUrl: './deal.html',
  styleUrls: ['./deal.scss'],
})
export class Deal {
  readonly style = input<string>('basic');
  readonly data = input<IOption | null>();

  readonly DealsModal = viewChild<DealsModal>('dealsModal');

  // Deal ids come from the header config input; the query filters the list to them.
  private readonly ids = computed<number[]>(() => this.data()?.header?.today_deals ?? []);
  private readonly dealQuery = injectDealProductsQuery(() =>
    this.ids().length ? { ids: this.ids().join() } : undefined,
  );

  public dealProducts: IProduct[];

  constructor() {
    effect(() => (this.dealProducts = this.dealQuery.data() ?? []));
  }
}
