import { Component, output, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IValues, IDeliveryBlock } from '@data-access/interfaces/setting.interface';

@Component({
  selector: 'app-delivery-block',
  templateUrl: './delivery-block.html',
  styleUrls: ['./delivery-block.scss'],
  imports: [TranslateModule],
})
export class DeliveryBlock {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly setting = input<IValues>();

  readonly selectDelivery = output<IDeliveryBlock>();

  public selectedIndex: number;
  public deliveryType: string | null = null;
  public delivery_description: string | null = null;
  public delivery_interval: string | null = null;

  ngOnInit() {
    const setting = this.setting();
    if (setting?.delivery) {
      // Automatically emit the selectAddress event for the first item if it's available
      let delivery: IDeliveryBlock = {
        delivery_description:
          setting.delivery?.default?.title + ' | ' + setting.delivery?.default?.description,
        delivery_interval: this.delivery_interval,
      };
      this.selectDelivery.emit(delivery);
    }
  }

  setDeliveryDescription(value: string, type: string) {
    this.delivery_description = value!;
    this.deliveryType = type;
    let delivery: IDeliveryBlock = {
      delivery_description: this.delivery_description,
      delivery_interval: this.delivery_interval,
    };
    this.selectDelivery.emit(delivery);
  }

  setDeliveryInterval(value: string, index: number) {
    this.selectedIndex = index!;
    this.delivery_interval = value;
    let delivery: IDeliveryBlock = {
      delivery_description: this.delivery_description,
      delivery_interval: this.delivery_interval,
    };
    this.selectDelivery.emit(delivery);
  }
}
