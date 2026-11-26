import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { ConsentStore } from '@core/consent/consent.store';
import { ILink } from '@data-access/interfaces/site-config.interface';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { InstallApp } from '@shared/ui/modal/install-help-modal/install-app';

@Component({
	selector: 'app-footer-links',
	templateUrl: './links.html',
	styleUrls: ['./links.scss'],
	imports: [RouterLink, TitleCasePipe, TranslocoModule],
})
export class Links {
	readonly links = input<ILink[]>([]);
	/** Adds the links that only Customer Service has: Cookie settings and Get the App. */
	readonly customerService = input(false);
	readonly consent = inject(ConsentStore);
	readonly install = inject(InstallApp);
}
