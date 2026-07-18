import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';

@Component({
	selector: 'app-error404',
	templateUrl: './error404.html',
	styleUrls: ['./error404.scss'],
	imports: [Breadcrumb, Button, TranslocoModule],
})
export class Error404 {
	private location = inject(Location);

	// Static status-page copy is Machine-1 (Transloco keys), not CMS/admin-editable.
	public breadcrumb: IBreadcrumb = {
		title: '404',
		items: [{ label: '404', active: true }],
	};

	back() {
		this.location.back();
	}
}
