import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, ShortDatePipe, apiProblem, requestKey } from '@core/purchasing/purchasing-format';
import { PurchasingGateway, type PostPreview } from '@core/purchasing/purchasing.gateway';
import { PluralPipe, translateCount } from '@shared/pipes/language.pipes';

import { warningText } from './entry-lines';
import { linesQuantity } from '../shared/purchasing-labels';

import type { PurchaseEntry } from '@saha-textile/contracts';

/**
 * Post to stock: the confirmation (p09). It states exactly what changes: pieces and SKUs, the
 * number the entry gets, cost added, the due date, the warnings being accepted. One request key
 * per popup, so a second press after a dropped connection never posts twice.
 */
@Component({
	selector: 'app-post-confirm',
	templateUrl: './post-confirm.html',
	imports: [PluralPipe, RupeesPipe, ShortDatePipe, TranslocoModule],
})
export class PostConfirm {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(PurchasingGateway);
	private readonly transloco = inject(TranslocoService);

	readonly entry = signal<PurchaseEntry | null>(null);
	readonly preview = signal<PostPreview | null>(null);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	private readonly key = requestKey('post');

	readonly intoStock = computed(() => {
		const entry = this.entry();
		if (!entry) return '';
		return linesQuantity(
			entry.lines.map((line) => ({ quantity: line.accepted ?? 0, soldBy: line.soldBy })),
			(key, n) => translateCount(this.transloco, key, n),
			(key, params) => this.transloco.translate(key, params),
			this.transloco.getActiveLang(),
		);
	});
	readonly warningLines = computed(() => {
		const money = (value: number) =>
			new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(
				value,
			);
		const entry = this.entry();
		return (this.preview()?.warnings ?? []).map((warning) => {
			const line = entry?.lines.find((row) => row.lineId === warning.lineId);
			const text = warningText(warning, (key, params) => this.transloco.translate(key, params), money);
			return line ? `${line.sku}: ${text}` : text;
		});
	});

	start(entry: PurchaseEntry, preview: PostPreview): void {
		this.entry.set(entry);
		this.preview.set(preview);
	}

	async post(): Promise<void> {
		const entry = this.entry();
		const preview = this.preview();
		if (!entry || !preview || this.busy()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const posted = await firstValueFrom(
				this.gateway.post(entry.id, {
					acceptWarningCodes: [...new Set(preview.warnings.map((warning) => warning.code))],
					requestKey: this.key,
					version: entry.version,
				}),
			);
			this.modal.close(posted);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
