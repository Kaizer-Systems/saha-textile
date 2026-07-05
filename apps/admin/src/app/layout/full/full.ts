import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
	selector: 'app-full',
	templateUrl: './full.html',
	styleUrls: ['./full.scss'],
	imports: [RouterModule],
})
export class Full {
	private platformId = inject<Object>(PLATFORM_ID);

	public isBrowser: boolean;

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
	}
}
