import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
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

import { ShippingCartTester } from './cart-tester';

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
	private readonly modals = inject(NgbModal);

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

	/** "Every live product resolves…" holds unless all the shop defaults are ₹0 (that check warns instead). */
	readonly zeroDefaults = computed(() =>
		(this.query.data()?.checks ?? []).some((check) => check.code === 'default_charges_zero'),
	);

	/** "1 category and 1 product have their own rules." (brief ov01), or that none do. */
	ownRules(): string {
		const t = (key: string, params?: Record<string, string | number>) => this.transloco.translate(key, params);
		const { categories, products } = this.query.data()?.exceptionTargets ?? { categories: 0, products: 0 };
		if (categories === 0 && products === 0) return t('ship_check_no_own_rules');
		const parts = [
			categories
				? t(categories === 1 ? 'ship_count_category_one' : 'ship_count_category_many', { n: categories })
				: '',
			products ? t(products === 1 ? 'ship_count_product_one' : 'ship_count_product_many', { n: products }) : '',
		].filter(Boolean);
		const list = parts.join(` ${t('ship_and')} `);
		return t(categories + products === 1 ? 'ship_check_own_rules_one' : 'ship_check_own_rules_many', { list });
	}

	openTester() {
		this.modals.open(ShippingCartTester, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'ship_tester_title',
		});
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
