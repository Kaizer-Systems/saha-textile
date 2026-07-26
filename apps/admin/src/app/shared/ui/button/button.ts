import { NgClass } from '@angular/common';
import { Component, effect, inject, input } from '@angular/core';

import { LoaderStore } from '@core/state/loader.store';

@Component({
	selector: 'app-button',
	templateUrl: './button.html',
	styleUrls: ['./button.scss'],
	imports: [NgClass],
})
export class Button {
	readonly class = input<string>('btn btn-theme ms-auto mt-4');
	readonly classData = input<string>('btn btn-theme ms-auto mt-4');
	readonly iconClass = input<string | null | undefined>();
	readonly id = input<string | undefined>();
	readonly label = input<string>('Submit');
	readonly type = input<string>('submit');
	readonly spinner = input<boolean>(true);
	readonly disabled = input<boolean>(false);

	public buttonId: string | null = null;

	readonly loader = inject(LoaderStore);

	constructor() {
		effect(() => {
			if (this.loader.buttonSpinner() === false) {
				this.buttonId = null;
			}
		});
	}

	public onClick(id: string): void {
		this.buttonId = id;
	}
}
