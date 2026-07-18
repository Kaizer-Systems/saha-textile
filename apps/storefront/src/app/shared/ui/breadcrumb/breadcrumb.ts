import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';

@Component({
	selector: 'app-breadcrumb',
	templateUrl: './breadcrumb.html',
	styleUrls: ['./breadcrumb.scss'],
	imports: [RouterLink, TitleCasePipe],
})
export class Breadcrumb {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly breadcrumb = input<IBreadcrumb | null>();
}
