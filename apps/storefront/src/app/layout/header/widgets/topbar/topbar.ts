import { Component, inject, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { ThemeModeStore } from '@core/brand/theme-mode';
import { ShopEvents } from '@core/events/shop-events';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { InstallApp } from '@shared/ui/modal/install-help-modal/install-app';

import { Currency } from '../currency/currency';
import { Language } from '../language/language';
import { Mode } from '../mode/mode';
import { Notice } from '../notice/notice';

@Component({
	selector: 'app-topbar',
	templateUrl: './topbar.html',
	styleUrls: ['./topbar.scss'],
	imports: [Notice, Language, Currency, Mode, TranslocoModule],
})
export class Topbar {
	readonly data = input<ISiteConfig | null>();
	readonly install = inject(InstallApp);
	readonly events = inject(ShopEvents);
	readonly themeMode = inject(ThemeModeStore);
}
