import { Component, input } from '@angular/core';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';

import { TranslateModule } from '@ngx-translate/core';
import { CarouselModule } from 'ngx-owl-carousel-o';

import { Button } from '@shared/ui/button/button';
import * as data from '../../../../shared/data/owl-carousel';
import { IOffer } from '@data-access/interfaces/theme.interface';

@Component({
  selector: 'app-wallet-offer',
  templateUrl: './wallet-offer.html',
  styleUrls: ['./wallet-offer.scss'],
  imports: [CarouselModule, ReactiveFormsModule, FormsModule, Button, TranslateModule],
})
export class WalletOffer {
  readonly offers = input<IOffer[]>();

  public customOptionsItem3 = data.customOptionsItem3;

  copyFunction(txt: string) {
    void navigator.clipboard.writeText(txt);
  }
}
