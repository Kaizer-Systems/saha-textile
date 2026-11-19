import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

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
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type { ShippingSettings, ShippingZone } from '@saha-textile/contracts';

/** Couriers that have an adapter slot (brief cr01). None is connected; each is an adapter for later. */
const COURIERS = [
	{ key: 'shiprocket', name: 'Shiprocket', zones: 'both' },
	{ key: 'delhivery', name: 'Delhivery', zones: 'domestic' },
	{ key: 'bluedart', name: 'Blue Dart', zones: 'domestic' },
	{ key: 'dhl', name: 'DHL Express', zones: 'international' },
] as const;

/**
 * Admin › Shipping › Couriers (brief cr01). Each zone chooses how it is priced: a rule set, or a
 * courier quote with a rule set to fall back on and an amount or percentage on top. Nothing is
 * connected yet, so the courier choices can't be picked; connecting one is an adapter behind the
 * shipping port.
 */
@Component({
	selector: 'app-shipping-couriers',
	templateUrl: './couriers.html',
	imports: [PageWrapper, FormFields, FormsModule, TranslocoModule],
})
export class ShippingCouriers {
	private readonly gateway = inject(ShippingGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly query = injectShippingOverviewQuery();
	readonly couriers = COURIERS;
	readonly zones: ShippingZone[] = ['domestic', 'international'];
	readonly canEdit = computed(() => this.auth.permissions().includes('shipping.edit'));
	readonly form = signal<ShippingSettings | null>(null);
	readonly saving = signal(false);

	constructor() {
		effect(() => {
			const data = this.query.data();
			if (data) this.form.set(structuredClone(data.settings ?? data.defaults));
		});
	}

	/** The active rule sets a zone can use: made for it, or for both. */
	ruleSetsFor(zone: ShippingZone) {
		return (this.query.data()?.ruleSets ?? []).filter(
			(r) => r.activeVersion !== null && (r.use === zone || r.use === 'both'),
		);
	}

	/** The "Price with" value: `ruleSet:<id>` or `courier:<key>`. */
	priceWith(zone: ShippingZone): string {
		const method = this.form()?.[zone];
		if (!method) return '';
		return method.kind === 'courier' ? `courier:${method.courierId}` : `ruleSet:${method.ruleSetId ?? ''}`;
	}

	setPriceWith(zone: ShippingZone, value: string) {
		const [kind, id] = value.split(':');
		if (kind !== 'ruleSet' || !id) return;
		this.form.update((form) => (form ? { ...form, [zone]: { kind: 'ruleSet', ruleSetId: id } } : form));
	}

	/** The fallback the zone would use if a courier quote fails: its rule set today. */
	fallbackId(zone: ShippingZone): string {
		const method = this.form()?.[zone];
		if (!method) return '';
		return (method.kind === 'courier' ? method.fallbackRuleSetId : method.ruleSetId) ?? '';
	}

	courierChosen(zone: ShippingZone): boolean {
		return this.form()?.[zone].kind === 'courier';
	}

	extra(zone: ShippingZone): { amountINR: number; percent: number } {
		const method = this.form()?.[zone];
		return method?.kind === 'courier' ? method.extra : { amountINR: 0, percent: 0 };
	}

	save() {
		const form = this.form();
		if (!form || this.saving()) return;
		this.saving.set(true);
		const { updatedAt: _at, updatedBy: _by, ...write } = form;
		void _at;
		void _by;
		this.gateway.saveSettings(write).subscribe({
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
