import { AsyncPipe, NgClass } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { LoaderStore } from '@core/state/loader.store';

@Component({
	selector: 'app-button',
	imports: [NgClass, AsyncPipe],
	templateUrl: './button.html',
	styleUrls: ['./button.scss'],
})
export class Button {
	readonly class = input<string>('btn btn-animation w-100 justify-content-center');
	readonly iconClass = input<string | null>();
	readonly id = input<string>();
	readonly label = input<string>();
	readonly type = input<string>('submit');
	readonly spinner = input<boolean>(true);
	readonly disabled = input<boolean>(false);

	public buttonId: string | null;

	private loaderStore = inject(LoaderStore);
	spinnerStatus$: Observable<boolean> = toObservable(this.loaderStore.button_spinner);

	constructor() {
		this.spinnerStatus$.subscribe((res) => {
			if (res == false) {
				this.buttonId = null;
			}
		});
	}

	public onClick(id: string) {
		this.buttonId = id;
	}
}
