import { Component, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { SiteConfigStore } from '@core/state/site-config.store';

@Component({
	selector: 'app-cookie',
	templateUrl: './cookie.html',
	styleUrls: ['./cookie.scss'],
	imports: [TranslocoModule],
})
export class Cookie {
	private siteConfigStore = inject(SiteConfigStore);

	cookies$: Observable<boolean> = toObservable(this.siteConfigStore.cookies);

	public cookies: boolean = true;

	constructor() {
		this.cookies$.subscribe((res) => (this.cookies = res));
	}

	acceptCookies(value: boolean) {
		this.siteConfigStore.updateSession('cookies', value);
	}
}
