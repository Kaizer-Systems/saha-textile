import { Component, output, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IValues, IDeliveryBlock } from '@data-access/interfaces/setting.interface';

@Component({
	selector: 'app-delivery-block',
	templateUrl: './delivery-block.html',
	styleUrls: ['./delivery-block.scss'],
	imports: [TranslocoModule],
})
export class DeliveryBlock {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly setting = input<IValues>(undefined);

	readonly selectDelivery = output<IDeliveryBlock>();

	public selectedIndex: number;
	public deliveryType: string | null = null;
	public delivery_description: string | null = null;
	public delivery_interval: string | null = null;

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
