import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { daysBetween, istDay } from '@saha-textile/core-domain/purchasing';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import {
	RupeesPipe,
	ShortDatePipe,
	ShortDateTimePipe,
	StockQuantityPipe,
	apiProblem,
	saveBlob,
} from '@core/purchasing/purchasing-format';
import { PURCHASING_KEYS, PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { PluralPipe } from '@shared/pipes/language.pipes';

import { OrderSend } from './order-send';
import { askReason } from '../shared/popups';
import { unitsText } from '../shared/purchasing-labels';

import type { PurchaseOrder, PurchaseOrderLine } from '@saha-textile/contracts';

/** The order's steps on the order page's tracking panel (po04), with the theme's tracking pictures. */
export const ORDER_STEPS: ReadonlyArray<{ svg: string; label: string; status: PurchaseOrder['status'] }> = [
	{ svg: 'pending', label: 'po_status_draft', status: 'draft' },
	{ svg: 'shipped', label: 'po_step_sent', status: 'sent' },
	{ svg: 'processing', label: 'po_status_part_received', status: 'part_received' },
	{ svg: 'delivered', label: 'po_status_received', status: 'received' },
];

/** How far along the steps an order is; closed and cancelled orders show the cancelled box after it. */
export function orderStep(order: Pick<PurchaseOrder, 'status' | 'lines' | 'sentAt'>): number {
	if (order.status === 'draft') return 0;
	if (order.status === 'sent') return 1;
	if (order.status === 'part_received') return 2;
	if (order.status === 'received') return 3;
	// Closed short after a part receipt, or cancelled after sending.
	const received = order.lines.some((line) => line.receivedQuantity > 0);
	return received ? 2 : order.sentAt ? 1 : 0;
}

export const stillToCome = (line: PurchaseOrderLine) => Math.max(0, line.quantity - line.receivedQuantity);

/** A purchase order (po04): ordered, received and still to come per line, with the entries that brought them. */
@Component({
	selector: 'app-order-view',
	templateUrl: './order-view.html',
	imports: [
		HasPermissionDirective,
		PageWrapper,
		PluralPipe,
		RouterModule,
		RupeesPipe,
		ShortDatePipe,
		ShortDateTimePipe,
		StockQuantityPipe,
		TranslocoModule,
	],
})
export class OrderView {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(PurchasingGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);

	readonly id = signal(this.route.snapshot.paramMap.get('id') ?? '');
	readonly tab = signal<'lines' | 'activity'>('lines');
	readonly steps = ORDER_STEPS;
	readonly today = istDay(new Date());

	readonly query = injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.orders, 'one', this.id()],
		queryFn: () => firstValueFrom(this.gateway.order(this.id())),
		enabled: !!this.id(),
	}));
	readonly activity = injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.orders, 'activity', this.id()],
		queryFn: () => firstValueFrom(this.gateway.orderActivity(this.id())),
		enabled: !!this.id() && this.tab() === 'activity',
	}));
	readonly order = computed(() => this.query.data() ?? null);
	readonly step = computed(() => {
		const order = this.order();
		return order ? orderStep(order) : 0;
	});
	readonly closed = computed(() => {
		const status = this.order()?.status;
		return status === 'closed_short' || status === 'cancelled';
	});
	readonly shortUnits = computed(() => (this.order()?.lines ?? []).reduce((sum, line) => sum + stillToCome(line), 0));
	readonly shortText = computed(() => {
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		return unitsText(
			(this.order()?.lines ?? []).map((line) => ({ quantity: stillToCome(line), soldBy: line.soldBy })),
			t,
		);
	});
	readonly totals = computed(() => {
		const lines = this.order()?.lines ?? [];
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		return {
			ordered: unitsText(lines, t),
			received: unitsText(
				lines.map((line) => ({ quantity: line.receivedQuantity, soldBy: line.soldBy })),
				t,
			),
			toCome: this.shortText(),
		};
	});
	readonly daysLate = computed(() => {
		const order = this.order();
		return order?.late ? daysBetween(order.expectedBy, this.today) : 0;
	});
	/** The entries that brought this order's goods, each once (po04 Received on, Linked entries). */
	readonly entries = computed(() => {
		const seen = new Map<string, string>();
		for (const line of this.order()?.lines ?? []) {
			for (const received of line.receivedOn) seen.set(received.entryId, received.number ?? received.entryId);
		}
		return [...seen.entries()].map(([id, number]) => ({ id, number }));
	});
	readonly canReceive = computed(() => {
		const status = this.order()?.status;
		return status === 'sent' || status === 'part_received';
	});
	/** Cancel only before anything arrives; after a part receipt the order is closed short instead. */
	readonly canCancel = computed(() => {
		const order = this.order();
		return (
			!!order &&
			(order.status === 'draft' || order.status === 'sent') &&
			order.lines.every((line) => line.receivedQuantity === 0)
		);
	});
	readonly canClose = computed(() => this.order()?.status === 'part_received' && this.shortUnits() > 0);

	private refresh(): void {
		void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.orders });
	}

	edit(): void {
		void this.router.navigate(['/purchase-orders', this.id(), 'edit']);
	}

	/** Receive goods: a new purchase entry filled with what is still to come (po04b). */
	receive(): void {
		void this.router.navigate(['/purchase-entries', 'create'], { queryParams: { order: this.id() } });
	}

	async send(): Promise<void> {
		const order = this.order();
		if (!order) return;
		let email: string | null = null;
		try {
			email = (await firstValueFrom(this.gateway.supplier(order.supplierId))).email;
		} catch {
			// The supplier's address is typed by hand then.
		}
		const popup = this.modals.open(OrderSend, {
			size: 'lg',
			windowClass: 'theme-modal modal-lg',
			ariaLabelledBy: 'order_send_title',
		});
		(popup.componentInstance as OrderSend).start(order, email);
		const sent = (await popup.result.catch(() => null)) as PurchaseOrder | null;
		if (!sent) return;
		this.notifier.showSuccess(this.transloco.translate('po_sent', { number: sent.number }));
		this.refresh();
	}

	async pdf(): Promise<void> {
		const order = this.order();
		if (!order) return;
		try {
			saveBlob(`${order.number.replace(/\//g, '-')}.pdf`, await firstValueFrom(this.gateway.orderPdf(order.id)));
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	async closeShort(): Promise<void> {
		const order = this.order();
		if (!order) return;
		const done = await askReason(this.modals, {
			title: 'po_close_short_title',
			body: 'po_close_short_body',
			params: { short: this.shortText(), number: order.number },
			label: 'reason',
			help: 'po_close_short_help',
			confirm: 'po_close_short_confirm',
			act: (reason) => firstValueFrom(this.gateway.closeOrder(order.id, reason)),
		});
		if (done) {
			this.notifier.showSuccess(this.transloco.translate('po_closed', { number: order.number }));
			this.refresh();
		}
	}

	async cancelOrder(): Promise<void> {
		const order = this.order();
		if (!order) return;
		const done = await askReason(this.modals, {
			title: 'po_cancel_title',
			body: 'po_cancel_body',
			params: { number: order.number },
			label: 'reason',
			confirm: 'po_cancel_confirm',
			confirmClass: 'btn-danger',
			act: (reason) => firstValueFrom(this.gateway.cancelOrder(order.id, reason)),
		});
		if (done) {
			this.notifier.showSuccess(this.transloco.translate('po_cancelled', { number: order.number }));
			this.refresh();
		}
	}

	async copy(): Promise<void> {
		try {
			const draft = await firstValueFrom(this.gateway.copyOrder(this.id()));
			this.notifier.showSuccess(this.transloco.translate('po_copied', { number: draft.number }));
			this.refresh();
			void this.router.navigate(['/purchase-orders', draft.id, 'edit']);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	still = stillToCome;
}
