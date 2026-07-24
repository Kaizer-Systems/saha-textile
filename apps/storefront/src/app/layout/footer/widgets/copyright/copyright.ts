import { Component, input } from '@angular/core';

import { ISiteConfig } from '@data-access/interfaces/site-config.interface';

@Component({
	selector: 'app-footer-copyright',
	templateUrl: './copyright.html',
	styleUrls: ['./copyright.scss'],
	imports: [],
})
export class Copyright {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly data = input<ISiteConfig | null>();
}
