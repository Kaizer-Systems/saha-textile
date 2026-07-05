import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';

@Component({
	selector: 'app-error403',
	templateUrl: './error403.html',
	styleUrls: ['./error403.scss'],
	imports: [RouterModule, TranslateModule],
})
export class Error403 {
	private location = inject(Location);

	back() {
		this.location.back();
	}
}
