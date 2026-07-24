import { Component, input } from '@angular/core';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { CarouselModule } from 'ngx-owl-carousel-o';

import { IOffer } from '@data-access/interfaces/theme.interface';
import { Button } from '@shared/ui/button/button';

import * as data from '../../../../shared/data/owl-carousel';

@Component({
	selector: 'app-wallet-offer',
	templateUrl: './wallet-offer.html',
	styleUrls: ['./wallet-offer.scss'],
	imports: [CarouselModule, ReactiveFormsModule, FormsModule, Button, TranslocoModule],
})
export class WalletOffer {
	readonly offers = input<IOffer[]>();

	public customOptionsItem3 = data.customOptionsItem3;

	copyFunction(txt: string) {
		void navigator.clipboard.writeText(txt);
	}
}
