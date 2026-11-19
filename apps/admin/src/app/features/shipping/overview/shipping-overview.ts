import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import {
	SHIPPING_KEY,
	ShippingGateway,
	injectShippingOverviewQuery,
	injectShippingRuleSetsQuery,
	shippingProblemKey,
} from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type {
	AdminShippingOverview,
	ShippingSettings,
	ShippingZone,
	ShippingZoneMethod,
} from '@saha-textile/contracts';

/**
 * Admin › Shipping › Overview (brief ov01): how each zone is priced, the home country, what
 * happens when a cart mixes rule sets, the shop-wide default charges, and the checks that warn
 * about gaps before a shopper meets them.
 */
@Component({
	selector: 'app-shipping-overview',
	templateUrl: './shipping-overview.html',
	imports: [PageWrapper, FormFields, FormsModule, RouterLink, TranslocoModule],
})
export class ShippingOverview {
	private readonly gateway = inject(ShippingGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly query = injectShippingOverviewQuery();
	readonly ruleSetsQuery = injectShippingRuleSetsQuery();
	readonly canEdit = computed(() => this.auth.permissions().includes('shipping.edit'));
	/** The settings as edited on this page. */
	readonly form = signal<ShippingSettings | null>(null);
	readonly saving = signal(false);
	readonly zones: ShippingZone[] = ['domestic', 'international'];

	constructor() {
		effect(() => {
			const data = this.query.data();
			if (data) this.form.set(structuredClone(data.settings ?? data.defaults));
		});
	}

	method(zone: ShippingZone): ShippingZoneMethod | null {
		return this.form()?.[zone] ?? null;
	}

	/** The rule set a zone uses, with its active version, for the zone card. */
	ruleSetOf(zone: ShippingZone) {
		const method = this.method(zone);
		const id = method?.kind === 'ruleSet' ? method.ruleSetId : (method?.fallbackRuleSetId ?? null);
		return id ? (this.query.data()?.ruleSets.find((r) => r.id === id) ?? null) : null;
	}

	/** The plain words of a zone's rule set, from the list (first line only, for the card). */
	describe(zone: ShippingZone): string {
		const ruleSet = this.ruleSetOf(zone);
		const row = ruleSet ? this.ruleSetsQuery.data()?.find((r) => r.ruleSet.id === ruleSet.id) : null;
		return row?.ruleSet.description ?? '';
	}

	notNeeded(zone: ShippingZone): boolean {
		return zone === 'international' && this.form()?.abroadPolicy === 'indiaOnly';
	}

	setCharge(kind: 'domestic' | 'internationalFirst' | 'internationalFurther', value: number | null) {
		this.form.update((form) =>
			form
				? { ...form, defaultCharges: { ...form.defaultCharges, [kind]: Math.max(0, Number(value) || 0) } }
				: form,
		);
	}

	setMixed(value: 'sum' | 'highest') {
		this.form.update((form) => (form ? { ...form, mixedRuleSets: value } : form));
	}

	checkIcon(check: AdminShippingOverview['checks'][number]): string {
		return check.severity === 'error' ? 'ri-error-warning-line text-danger' : 'ri-alert-line text-warning';
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
