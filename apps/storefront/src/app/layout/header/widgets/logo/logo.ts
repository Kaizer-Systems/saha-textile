import { Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { Observable } from 'rxjs';

import { SiteConfigStore } from '@core/state/site-config.store';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';

@Component({
	selector: 'app-logo',
	templateUrl: './logo.html',
	styleUrls: ['./logo.scss'],
	imports: [RouterLink],
})
export class Logo {
	readonly textClass = input<string>('text-white f-w-600');
	readonly data = input<ISiteConfig | null>();
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly logo = input<string | null>();

	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;
}
