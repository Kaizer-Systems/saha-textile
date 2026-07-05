import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

@Component({
	selector: 'app-error404',
	templateUrl: './error404.html',
	styleUrls: ['./error404.scss'],
	imports: [TranslateModule],
})
export class Error404 {
	private location = inject(Location);

	back() {
		this.location.back();
	}
}
