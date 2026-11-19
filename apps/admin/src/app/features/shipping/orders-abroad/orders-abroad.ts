import { Component, computed, effect, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import {
	SHIPPING_KEY,
	ShippingGateway,
	injectShippingOverviewQuery,
	shippingProblemKey,
} from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { AbroadOrderPolicy } from '@saha-textile/contracts';

/** The four address cases of the export-off path (brief io01): billing, delivery, invoice, shopper sees. */
const CASES = [
	['india', 'india', 'billing', 'normal'],
	['india', 'abroad', 'billing', 'normal'],
	['abroad', 'india', 'delivery', 'normal'],
	['abroad', 'abroad', 'given', 'form'],
] as const;

/**
 * Admin › Shipping › Orders sent abroad (brief io01): the named path for orders delivered outside
 * the home country. Saha Textile runs "Export off, invoice to an address in India"; "Standard
 * export" is designed but cannot be chosen until it is built.
 */
@Component({
	selector: 'app-orders-abroad',
	templateUrl: './orders-abroad.html',
	imports: [PageWrapper, TranslocoModule],
})
export class OrdersAbroad {
	private readonly gateway = inject(ShippingGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly query = injectShippingOverviewQuery();
	readonly canEdit = computed(() => this.auth.permissions().includes('shipping.edit'));
	readonly policies: AbroadOrderPolicy[] = ['exportOffIndianInvoice', 'standardExport', 'indiaOnly'];
	readonly cases = CASES;
	readonly chosen = signal<AbroadOrderPolicy | null>(null);
	readonly saving = signal(false);

	constructor() {
		effect(() => {
			const data = this.query.data();
			if (data) this.chosen.set((data.settings ?? data.defaults).abroadPolicy);
		});
	}

	available(policy: AbroadOrderPolicy): boolean {
		return this.query.data()?.abroadPolicies.includes(policy) ?? false;
	}

	save() {
		const data = this.query.data();
		const policy = this.chosen();
		if (!data || !policy || this.saving()) return;
		const { updatedAt: _at, updatedBy: _by, ...current } = data.settings ?? data.defaults;
		void _at;
		void _by;
		this.saving.set(true);
		this.gateway.saveSettings({ ...current, abroadPolicy: policy }).subscribe({
			next: () => {
				this.saving.set(false);
				this.notifier.showSuccess(this.transloco.translate('ship_settings_saved'));
				void this.queryClient.invalidateQueries({ queryKey: SHIPPING_KEY });
			},
			error: (error: unknown) => {
				this.saving.set(false);
				this.notifier.showError(this.transloco.translate(shippingProblemKey(error)));
			},
		});
	}
}
