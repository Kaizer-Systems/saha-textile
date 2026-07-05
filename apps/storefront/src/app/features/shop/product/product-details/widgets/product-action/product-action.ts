
import { Component, inject, input, viewChild } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { DeliveryReturnModal } from '@shared/ui/modal/delivery-return-modal/delivery-return-modal';
import { QuestionModal } from '@shared/ui/modal/question-modal/question-modal';
import { SizeChartModal } from '@shared/ui/modal/size-chart-modal/size-chart-modal';
import { IProduct } from '@data-access/interfaces/product.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ThemeOptionState } from '@data-access/states/theme-option.state';

@Component({
  selector: 'app-product-action',
  templateUrl: './product-action.html',
  styleUrls: ['./product-action.scss'],
  imports: [SizeChartModal, DeliveryReturnModal, QuestionModal, TranslateModule],
})
export class ProductAction {
  private store = inject(Store);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly product = input<IProduct>();

  readonly SizeChartModal = viewChild<SizeChartModal>('sizeChartModal');
  readonly DeliveryReturnModal = viewChild<DeliveryReturnModal>('deliveryReturnModal');
  readonly QuestionModal = viewChild<QuestionModal>('questionModal');

  themeOptions$: Observable<IOption> = inject(Store).select(
    ThemeOptionState.themeOptions,
  ) as Observable<IOption>;

  public policy: string;
  public isLogin: boolean;

  constructor() {
    this.themeOptions$.subscribe(option => {
      this.policy = option?.product?.shipping_and_return;
    });
    this.isLogin = !!this.store.selectSnapshot(state => state.auth && state.auth.access_token);
  }
}
