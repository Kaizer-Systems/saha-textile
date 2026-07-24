import { Component, input } from '@angular/core';

import { ISiteConfig } from '@data-access/interfaces/site-config.interface';

@Component({
	selector: 'app-footer-about',
	templateUrl: './about.html',
	styleUrls: ['./about.scss'],
	imports: [],
})
export class About {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly data = input<ISiteConfig | null>();
}
