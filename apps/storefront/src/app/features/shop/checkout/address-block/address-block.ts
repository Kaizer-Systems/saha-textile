import { Component, output, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IUserAddress } from '@data-access/interfaces/user.interface';

@Component({
  selector: 'app-address-block',
  templateUrl: './address-block.html',
  styleUrls: ['./address-block.scss'],
  imports: [TranslateModule],
})
export class AddressBlock {
  readonly addresses = input<IUserAddress[] | undefined>([]);
  readonly type = input<string>('shipping');

  readonly selectAddress = output<number>();

  constructor() {}

  ngOnInit() {
    // Automatically emit the selectAddress event for the first item if it's available
    const addresses = this.addresses();
    if (addresses && addresses.length > 0) {
      const firstAddressId = addresses[0].id;
      this.selectAddress.emit(firstAddressId);
    }
  }

  set(event: Event) {
    this.selectAddress.emit(Number((<HTMLInputElement>event.target)?.value));
  }
}
