import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

@Component({
	selector: 'app-error404',
	templateUrl: './error404.html',
	styleUrls: ['./error404.scss'],
	imports: [TranslocoModule],
})
export class Error404 {
	private location = inject(Location);

	back() {
		this.location.back();
	}
}
