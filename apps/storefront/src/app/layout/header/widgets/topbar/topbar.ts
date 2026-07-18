import { Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { ISiteConfig } from '@data-access/interfaces/site-config.interface';

import { Currency } from '../currency/currency';
import { Language } from '../language/language';
import { Notice } from '../notice/notice';

@Component({
	selector: 'app-topbar',
	templateUrl: './topbar.html',
	styleUrls: ['./topbar.scss'],
	imports: [Notice, Language, Currency, TranslocoModule],
})
export class Topbar {
	readonly data = input<ISiteConfig | null>();
}
