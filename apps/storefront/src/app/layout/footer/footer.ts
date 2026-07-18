import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { SiteConfigStore } from '@core/state/site-config.store';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { IFooter } from '@data-access/interfaces/theme.interface';

import { BasicFooter } from './basic-footer/basic-footer';

@Component({
	selector: 'app-footer',
	templateUrl: './footer.html',
	styleUrls: ['./footer.scss'],
	imports: [BasicFooter, AsyncPipe],
})
export class Footer {
	readonly footer = input<IFooter>();

	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;
}
