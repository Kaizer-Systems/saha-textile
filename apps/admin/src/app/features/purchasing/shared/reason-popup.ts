import { Component, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { apiProblem } from '@core/purchasing/purchasing-format';

/** What the popup asks for (texts are translation keys; `params` fill them). */
export interface ReasonAsk {
	title: string;
	body?: string;
	params?: Record<string, unknown>;
	label: string;
	help?: string;
	confirm: string;
	/** `btn-danger` for a refusal or a write-off, `btn-theme` otherwise. */
	confirmClass?: string;
	/** Run on confirm; a refusal keeps the popup open with its sentence. */
	act: (reason: string) => Promise<unknown>;
}

/** The shortest reason the API takes (close, cancel, void, reject, reverse). */
export const MIN_REASON = 3;

/**
 * A form popup that asks why (theme-modal): closing an order short, cancelling it, voiding an
 * entry, rejecting a write-off (i05b), reversing a payment. The reason is required and goes into
 * the audit log word for word.
 */
@Component({
	selector: 'app-reason-popup',
	templateUrl: './reason-popup.html',
	imports: [TranslocoModule],
})
export class ReasonPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly transloco = inject(TranslocoService);

	readonly ask = signal<ReasonAsk | null>(null);
	readonly reason = signal('');
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);

	start(ask: ReasonAsk): void {
		this.ask.set(ask);
	}

	canConfirm(): boolean {
		return this.reason().trim().length >= MIN_REASON && !this.busy();
	}

	async confirm(): Promise<void> {
		const ask = this.ask();
		if (!ask || !this.canConfirm()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const result = await ask.act(this.reason().trim());
			this.modal.close(result ?? true);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
