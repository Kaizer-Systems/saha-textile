import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { ConsentStore } from '@core/consent/consent.store';
import { ILink } from '@data-access/interfaces/site-config.interface';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';

@Component({
	selector: 'app-footer-links',
	templateUrl: './links.html',
	styleUrls: ['./links.scss'],
	imports: [RouterLink, TitleCasePipe, TranslocoModule],
})
export class Links {
	readonly links = input<ILink[]>([]);
	/** Adds the link that reopens Cookie settings. */
	readonly cookieSettings = input(false);
	readonly consent = inject(ConsentStore);
}
