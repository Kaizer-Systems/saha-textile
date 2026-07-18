import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ILink } from '@data-access/interfaces/site-config.interface';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';

@Component({
	selector: 'app-footer-links',
	templateUrl: './links.html',
	styleUrls: ['./links.scss'],
	imports: [RouterLink, TitleCasePipe],
})
export class Links {
	readonly links = input<ILink[]>([]);
}
