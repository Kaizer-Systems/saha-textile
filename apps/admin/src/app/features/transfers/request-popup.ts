import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { apiProblem } from '@core/purchasing/purchasing-format';
import { TransfersGateway, transferProblemKey } from '@core/transfers/transfers.gateway';

import { quantityText } from './transfer-format';

import type { LocationStockView } from '@saha-textile/contracts';

/** What the stock page hands the request popup: the page it read, and the row asked from (or none). */
export interface RequestStart {
	view: LocationStockView;
	item: LocationStockView['items'][number] | null;
}

/**
 * Request stock (accounts brief N2): for the location the header chip is on (or one picked), which item, from which
 * location with how much free there, how many, by when, and a note to the sender. Nothing moves until they approve.
 */
@Component({
	selector: 'app-request-popup',
	templateUrl: './request-popup.html',
	imports: [TranslocoModule, FormsModule],
})
export class RequestPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(TransfersGateway);

	readonly view = signal<LocationStockView | null>(null);
	readonly variantId = signal('');
	readonly to = signal('');
	readonly from = signal('');
	readonly quantity = signal(1);
	readonly neededBy = signal('');
	readonly note = signal('');
	readonly busy = signal(false);
	readonly problem = signal<{ key: string; params: Record<string, string> } | null>(null);

	readonly item = computed(() => this.view()?.items.find((i) => i.variantId === this.variantId()) ?? null);
	/** Every other location, with what it has free of the item. */
	readonly sources = computed(() => {
		const view = this.view();
		const item = this.item();
		if (!view || !item) return [];
		return view.locations
			.filter((l) => l.id !== this.to())
			.map((l) => ({ ...l, free: item.byLocation[l.id]?.free ?? 0 }));
	});
	readonly ready = computed(
		() =>
			!!this.item() &&
			!!this.to() &&
			!!this.from() &&
			this.from() !== this.to() &&
			this.quantity() > 0 &&
			!this.busy(),
	);

	start(start: RequestStart): void {
		this.view.set(start.view);
		this.variantId.set(start.item?.variantId ?? start.view.items[0]?.variantId ?? '');
		this.to.set(start.view.here ?? '');
		const best = [...this.sources()].sort((a, b) => b.free - a.free)[0];
		this.from.set(best?.id ?? '');
		this.quantity.set(this.item()?.soldBy === 'metre' ? 10 : 1);
	}

	text(quantity: number): string {
		return quantityText(quantity, this.item()?.soldBy ?? 'piece');
	}

	async send(): Promise<void> {
		if (!this.ready()) return;
		this.busy.set(true);
		this.problem.set(null);
		try {
			const sent = await firstValueFrom(
				this.gateway.request({
					fromLocationId: this.from(),
					toLocationId: this.to(),
					lines: [{ variantId: this.variantId(), quantity: this.quantity() }],
					neededBy: this.neededBy() || null,
					forOrderId: null,
					note: this.note().trim(),
				}),
			);
			this.modal.close(sent);
		} catch (error) {
			this.problem.set(transferProblemKey(apiProblem(error, 'cash_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
