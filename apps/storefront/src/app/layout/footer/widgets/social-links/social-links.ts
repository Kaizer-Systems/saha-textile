import { Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { ISiteConfig } from '@data-access/interfaces/site-config.interface';

@Component({
	selector: 'app-footer-social-links',
	templateUrl: './social-links.html',
	styleUrls: ['./social-links.scss'],
	imports: [TranslocoModule],
})
export class SocialLinks {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly data = input<ISiteConfig | null>();
}
