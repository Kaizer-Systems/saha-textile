import { Component, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IProduct } from '@data-access/interfaces/product.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';

@Component({
  selector: 'app-payment-option',
  templateUrl: './payment-option.html',
  styleUrls: ['./payment-option.scss'],
  imports: [TranslateModule],
})
export class PaymentOption {
  readonly product = input<IProduct>();
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly option = input<IOption | null>();
}
