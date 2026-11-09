import { Component } from '@angular/core';

import { TranslocoPipe } from '@jsverse/transloco';

@Component({
	selector: 'app-mode',
	templateUrl: './mode.html',
	imports: [TranslocoPipe],
	styleUrls: ['./mode.scss'],
	standalone: true,
})
export class Mode {
	customizeLayoutDark() {
		document.body.classList.toggle('dark-only');
	}
}
