import { Component } from '@angular/core';

@Component({
	selector: 'app-mode',
	templateUrl: './mode.html',
	styleUrls: ['./mode.scss'],
	standalone: true,
})
export class Mode {
	customizeLayoutDark() {
		document.body.classList.toggle('dark-only');
	}
}
