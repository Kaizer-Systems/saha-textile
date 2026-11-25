import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

import { PIN_LENGTH, PinBoxes } from '../../shared/pin-boxes';

import type { CodeDone, VendorAnswer } from '@saha-textile/release-console-contracts';

/**
 * A change on the Code pages (brief 7Hu1SuB3A8qiJzeDwvFZLR, Part C): the console's own form box (rc-modal) with what
 * the change needs (projected), the console PIN and the button. GitHub's answer is said in the box: what changed
 * with its link, or GitHub's own reason it refused, and nothing changes.
 */
@Component({
	selector: 'rc-code-change',
	imports: [PinBoxes],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div
			class="rc-modal-back"
			(keydown.escape)="closed.emit()"
		>
			<form
				class="rc-modal"
				role="dialog"
				[attr.aria-label]="title()"
				(submit)="$event.preventDefault(); send()"
			>
				<div class="rc-row between">
					<h3 class="rc-h">{{ title() }}</h3>
					<button
						type="button"
						class="rc-btn ghost"
						(click)="closed.emit()"
					>
						Close
					</button>
				</div>
				@if (done(); as d) {
					<div class="rc-banner small ok">
						<span class="rc-dot ok"></span>
						<div>
							{{ d.message }}
							@if (d.url) {
								·
								<a
									[href]="d.url"
									target="_blank"
									rel="noopener"
								>
									Open on GitHub ↗
								</a>
							}
						</div>
					</div>
					<div class="rc-row end">
						<button
							type="button"
							class="rc-btn primary"
							(click)="finished.emit(d)"
						>
							Done
						</button>
					</div>
				} @else {
					<div class="rc-form">
						<ng-content />
						<label>
							PIN
							<rc-pin-boxes
								[label]="'Console PIN to ' + submit().toLowerCase()"
								[disabled]="busy()"
								(changed)="pin.set($event)"
							/>
						</label>
					</div>
					@if (error()) {
						<div class="rc-banner small red">
							<span class="rc-dot red"></span>
							<div>{{ error() }}</div>
						</div>
					}
					<div class="rc-row end">
						<button
							type="button"
							class="rc-btn ghost"
							(click)="closed.emit()"
						>
							Cancel
						</button>
						<button
							type="submit"
							class="rc-btn"
							[class.primary]="!danger()"
							[class.danger]="danger()"
							[disabled]="pin().length !== pinLength || busy() || !ready()"
						>
							{{ busy() ? 'Sending…' : submit() }}
						</button>
					</div>
				}
			</form>
		</div>
	`,
})
export class CodeChange {
	readonly title = input.required<string>();
	readonly submit = input.required<string>();
	readonly danger = input(false);
	/** False while the projected fields are not filled in. */
	readonly ready = input(true);
	/** Sends the change with the PIN typed; the answer is GitHub's, through the console API. */
	readonly run = input.required<(pin: string) => Promise<VendorAnswer<CodeDone>>>();
	readonly closed = output<void>();
	readonly finished = output<CodeDone>();
	protected readonly pinLength = PIN_LENGTH;
	readonly pin = signal('');
	readonly busy = signal(false);
	readonly error = signal('');
	readonly done = signal<CodeDone | null>(null);

	async send(): Promise<void> {
		this.busy.set(true);
		this.error.set('');
		try {
			const a = await this.run()(this.pin());
			if (a.state === 'ok') this.done.set(a.data);
			else this.error.set(a.message);
		} catch (error) {
			this.error.set((error as Error).message);
		} finally {
			this.busy.set(false);
		}
	}
}
