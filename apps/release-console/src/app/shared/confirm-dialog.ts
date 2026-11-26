import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';

/** One question for the owner: a title, what happens, and the words on the confirming button. */
export interface ConfirmRequest {
	title: string;
	body: string;
	confirm: string;
	/** A change that removes something shows its button red. */
	danger?: boolean;
}

/**
 * Asks inside the console instead of the browser's own box (owner, 21 Nov: "it should come as a popup
 * within the application"). One question at a time; the answer is a promise.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmDialog {
	readonly open = signal<(ConfirmRequest & { answer: (yes: boolean) => void }) | null>(null);

	ask(request: ConfirmRequest): Promise<boolean> {
		this.open()?.answer(false);
		return new Promise((resolve) => this.open.set({ ...request, answer: resolve }));
	}

	reply(yes: boolean): void {
		const current = this.open();
		this.open.set(null);
		current?.answer(yes);
	}
}

/** Draws the open question with the console's own dialog (rc-modal), once, in the shell. */
@Component({
	selector: 'rc-confirm-host',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (dialog.open(); as q) {
			<div
				class="rc-modal-back"
				(keydown.escape)="dialog.reply(false)"
			>
				<form
					class="rc-modal"
					role="alertdialog"
					[attr.aria-label]="q.title"
					(submit)="$event.preventDefault(); dialog.reply(true)"
				>
					<h3 class="rc-h">{{ q.title }}</h3>
					<p class="rc-p">{{ q.body }}</p>
					<div class="rc-row end">
						<button
							type="button"
							class="rc-btn ghost"
							(click)="dialog.reply(false)"
						>
							Cancel
						</button>
						<button
							type="submit"
							class="rc-btn"
							[class.danger]="q.danger"
							[class.primary]="!q.danger"
						>
							{{ q.confirm }}
						</button>
					</div>
				</form>
			</div>
		}
	`,
})
export class ConfirmHost {
	protected readonly dialog = inject(ConfirmDialog);
}
