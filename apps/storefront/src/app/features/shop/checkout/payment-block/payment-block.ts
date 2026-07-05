import { UpperCasePipe } from '@angular/common';
import { Component, output, input } from '@angular/core';

import { IValues } from '@data-access/interfaces/setting.interface';

@Component({
  selector: 'app-payment-block',
  templateUrl: './payment-block.html',
  styleUrls: ['./payment-block.scss'],
  imports: [UpperCasePipe],
})
export class PaymentBlock {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly setting = input<IValues>();

  readonly selectPaymentMethod = output<string>();

  constructor() {}

  ngOnInit() {
    // Automatically emit the selectAddress event for the first item if it's available
    const setting = this.setting();
    if (setting && setting?.payment_methods?.length! > 0) {
      if (setting?.payment_methods?.[0].status) {
        this.selectPaymentMethod.emit(setting?.payment_methods?.[0].name);
      }
    }
  }

  set(value: string) {
    this.selectPaymentMethod.emit(value);
  }
}
