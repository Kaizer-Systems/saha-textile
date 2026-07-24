import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

@Component({
	selector: 'app-error403',
	templateUrl: './error403.html',
	styleUrls: ['./error403.scss'],
	imports: [RouterModule, TranslocoModule],
})
export class Error403 {
	private location = inject(Location);

	back() {
		this.location.back();
	}
}
