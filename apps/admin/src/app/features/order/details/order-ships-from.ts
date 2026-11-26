import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, input, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { ORDERS_KEY } from '@core/orders/orders.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import type { ShipsFromView } from '@saha-textile/contracts';

/**
 * The order page's Ships from card and Assign location pop-up (accounts brief M1, as drawn; D14 approved
 * 2026-11-23): each piece's free stock at each shipping location, and the choice of where the order ships from.
 * The held pieces move with it in one step. Split and "after a transfer" are shown but wait for Transfers (C3).
 */
@Component({
	selector: 'app-order-ships-from',
	imports: [TranslocoModule, FormsModule],
	templateUrl: './order-ships-from.html',
})
export class OrderShipsFromCard {
	private readonly http = inject(HttpClient);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly orderId = input.required<string>();
	readonly orderNumber = input<string>('');
	private readonly url = computed(
		() => `${runtimeConfig.apiUrl}/admin/orders/${encodeURIComponent(this.orderId())}/ships-from`,
	);
	readonly canAssign = computed(() => this.auth.permissions().includes('order.edit'));
	readonly view = injectQuery(() => ({
		queryKey: [...ORDERS_KEY, 'ships-from', this.orderId()],
		queryFn: () => firstValueFrom(this.http.get<ShipsFromView>(this.url())),
		enabled: !!this.orderId(),
	}));
	readonly currentName = computed(() => {
		const v = this.view.data();
		return v?.locations.find((l) => l.id === v.current)?.name ?? null;
	});
	readonly choice = signal<string>('');
	readonly saving = signal(false);
	private modal: NgbModalRef | null = null;

	has(locationId: string): { has: number; of: number } {
		const c = this.view.data()?.candidates.find((x) => x.locationId === locationId);
		return { has: c?.has ?? 0, of: c?.of ?? 0 };
	}

	open(template: TemplateRef<unknown>): void {
		this.choice.set(this.view.data()?.current ?? '');
		this.modal = this.modals.open(template, { centered: true, size: 'lg' });
	}

	async assign(): Promise<void> {
		const v = this.view.data();
		if (!v) return;
		this.saving.set(true);
		try {
			await firstValueFrom(
				this.http.post(this.url(), { locationId: this.choice() || null, revision: v.revision, reason: '' }),
			);
			await this.queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
			this.notifier.showSuccess(this.transloco.translate('ships_from_saved'));
			this.modal?.close();
		} catch (error) {
			const code = (error as { error?: { error?: { message?: string } } }).error?.error?.message ?? '';
			this.notifier.showError(
				this.transloco.translate(
					code === 'order_changed'
						? 'ships_from_changed'
						: code === 'location_out_of_scope'
							? 'ships_from_out_of_scope'
							: 'ships_from_failed',
				),
			);
		} finally {
			this.saving.set(false);
		}
	}
}
