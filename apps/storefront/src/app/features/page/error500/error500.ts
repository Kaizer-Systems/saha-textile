import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';

@Component({
	selector: 'app-error500',
	templateUrl: './error500.html',
	styleUrls: ['./error500.scss'],
	imports: [Breadcrumb, Button, TranslocoModule],
})
export class Error500 {
	private location = inject(Location);

	// Static status-page copy is Machine-1 (Transloco keys), not CMS/admin-editable.
	public breadcrumb: IBreadcrumb = {
		title: '500',
		items: [{ label: '500', active: true }],
	};

	back() {
		this.location.back();
	}
}
