import { Component, Input } from '@angular/core';

import * as feather from 'feather-icons';

@Component({
	selector: 'app-feather-icons',
	templateUrl: './feather-icons.html',
	styleUrls: ['./feather-icons.scss'],
	standalone: true,
})
export class FeatherIcons {
	@Input('icon') public icon = '';

	constructor() {}

	ngAfterContentInit() {
		feather.replace();
	}
}
