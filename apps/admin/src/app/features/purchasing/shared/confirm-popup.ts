import { Component, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

/** What a confirmation asks: translation keys and their params. */
export interface ConfirmAsk {
	icon: string;
	title: string;
	body: string;
	params?: Record<string, unknown>;
	yes: string;
}

/**
 * A yes-or-no question with its own words, in the theme's confirmation layout (icon-box,
 * button-box). Closes with `true` on yes; dismissed otherwise.
 */
@Component({
	selector: 'app-confirm-popup',
	template: `
		@if (ask(); as current) {
			<div class="modal-body">
				<i [class]="current.icon + ' icon-box'"></i>
				<h5
					class="modal-title"
					id="confirm_popup_title"
				>
					{{ current.title | transloco: current.params ?? {} }}
				</h5>
				<p>{{ current.body | transloco: current.params ?? {} }}</p>
				<div class="button-box">
					<button
						type="button"
						class="btn-md fw-bold btn btn-secondary"
						(click)="modal.dismiss()"
					>
						{{ 'cancel' | transloco }}
					</button>
					<button
						type="button"
						class="btn-theme btn-md fw-bold btn"
						id="confirm_popup_yes"
						(click)="modal.close(true)"
					>
						{{ current.yes | transloco: current.params ?? {} }}
					</button>
				</div>
			</div>
		}
	`,
	imports: [TranslocoModule],
})
export class ConfirmPopup {
	readonly modal = inject(NgbActiveModal);
	readonly ask = signal<ConfirmAsk | null>(null);

	start(ask: ConfirmAsk): void {
		this.ask.set(ask);
	}
}
