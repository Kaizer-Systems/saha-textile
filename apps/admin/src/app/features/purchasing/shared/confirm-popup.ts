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
	/** A second answer that is not "cancel": closes with false (askYesNo). */
	no?: string;
	/** Short lines listed under the question (already in the reader's words). */
	items?: readonly string[];
	/** A note under the list, e.g. "and 12 more". */
	more?: string;
	/** The way out's words when "Cancel" isn't right, e.g. "Not yet" (shipping brief rb11). */
	cancel?: string;
	/** An optional comment box under the question (orders brief oo06); yes then closes with `{ comment }`. */
	comment?: { label: string; placeholder?: string };
	/** A red yes button, for removing something (oo06). */
	danger?: boolean;
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
				@if (current.items?.length) {
					<ul
						class="list-unstyled small text-muted mx-auto mb-3 text-start"
						style="max-width: 420px"
					>
						@for (item of current.items; track $index) {
							<li>{{ item }}</li>
						}
						@if (current.more) {
							<li>{{ current.more }}</li>
						}
					</ul>
				}
				@if (current.comment; as box) {
					<div class="theme-form mb-3 text-start">
						<label
							class="form-label"
							for="confirm_popup_comment"
						>
							{{ box.label | transloco }}
						</label>
						<input
							class="form-control"
							id="confirm_popup_comment"
							maxlength="300"
							autocomplete="off"
							[placeholder]="box.placeholder ? (box.placeholder | transloco) : ''"
							[value]="comment()"
							(input)="comment.set($any($event.target).value)"
						/>
					</div>
				}
				<div class="button-box">
					<button
						type="button"
						class="btn-md fw-bold btn btn-secondary"
						(click)="modal.dismiss()"
					>
						{{ current.cancel ?? 'cancel' | transloco }}
					</button>
					@if (current.no) {
						<button
							type="button"
							class="btn-md fw-bold btn btn-outline"
							id="confirm_popup_no"
							(click)="modal.close(false)"
						>
							{{ current.no | transloco: current.params ?? {} }}
						</button>
					}
					<button
						type="button"
						class="btn-md fw-bold btn"
						[class.btn-theme]="!current.danger"
						[class.btn-danger]="current.danger"
						id="confirm_popup_yes"
						(click)="yes()"
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
	readonly comment = signal('');

	start(ask: ConfirmAsk): void {
		this.ask.set(ask);
	}

	yes(): void {
		this.modal.close(this.ask()?.comment ? { comment: this.comment().trim() } : true);
	}
}
