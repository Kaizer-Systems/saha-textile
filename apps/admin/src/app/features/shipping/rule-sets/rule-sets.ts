import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import {
	SHIPPING_KEY,
	ShippingGateway,
	injectShippingRuleSetsQuery,
	shippingProblemKey,
} from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { askConfirm } from '@features/purchasing/shared/popups';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { AdminShippingRuleSetRow } from '@saha-textile/contracts';

type Filter = 'all' | 'own' | 'premade' | 'drafts';

/**
 * Admin › Shipping › Rule sets (brief rl01): every way of charging shipping. Pre-made rule sets are
 * locked (View, Make a copy); the shop's own can be edited, copied, and deleted while nothing uses
 * them. Drafts are never used at checkout.
 */
@Component({
	selector: 'app-shipping-rule-sets',
	templateUrl: './rule-sets.html',
	imports: [PageWrapper, RouterLink, TranslocoModule],
})
export class ShippingRuleSets {
	private readonly gateway = inject(ShippingGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly modals = inject(NgbModal);
	private readonly router = inject(Router);
	private readonly auth = inject(AuthStore);

	readonly query = injectShippingRuleSetsQuery();
	readonly filter = signal<Filter>('all');
	readonly filters: Filter[] = ['all', 'own', 'premade', 'drafts'];
	readonly canCreate = computed(() => this.auth.permissions().includes('shipping.create'));
	readonly canEdit = computed(() => this.auth.permissions().includes('shipping.edit'));
	readonly canDelete = computed(() => this.auth.permissions().includes('shipping.destroy'));

	readonly rows = computed(() => {
		const rows = this.query.data() ?? [];
		switch (this.filter()) {
			case 'own':
				return rows.filter((row) => row.ruleSet.kind === 'own');
			case 'premade':
				return rows.filter((row) => row.ruleSet.kind === 'premade');
			case 'drafts':
				return rows.filter((row) => row.ruleSet.activeVersion === null);
			default:
				return rows;
		}
	});

	count(filter: Filter): number {
		const rows = this.query.data() ?? [];
		if (filter === 'own') return rows.filter((row) => row.ruleSet.kind === 'own').length;
		if (filter === 'premade') return rows.filter((row) => row.ruleSet.kind === 'premade').length;
		if (filter === 'drafts') return rows.filter((row) => row.ruleSet.activeVersion === null).length;
		return rows.length;
	}

	/** Where a rule set applies, as words: "Site-wide (domestic)", "2 exceptions", or a dash. */
	whereUsed(row: AdminShippingRuleSetRow): string {
		const parts = row.usage.zones.map((use) =>
			this.transloco.translate(`ship_used_${use.as}`, {
				zone: this.transloco.translate(`ship_zone_${use.zone}`),
			}),
		);
		if (row.usage.exceptionIds.length)
			parts.push(this.transloco.translate('ship_used_exceptions', { count: row.usage.exceptionIds.length }));
		if (parts.length) return parts.join(' · ');
		// A courier quote can't be used until a courier is connected (brief rl01).
		return row.ruleSet.premadeKey === 'courier-quote' ? this.transloco.translate('ship_needs_courier') : '—';
	}

	inUse(row: AdminShippingRuleSetRow): boolean {
		return row.usage.zones.length > 0 || row.usage.exceptionIds.length > 0;
	}

	/** "19 Nov · Moulik": the day it was last saved and who saved it (brief rl01). */
	edited(row: AdminShippingRuleSetRow): string {
		if (row.ruleSet.kind === 'premade' || !row.ruleSet.updatedAt) return '—';
		const day = new Date(row.ruleSet.updatedAt).toLocaleDateString('en-IN', {
			timeZone: 'Asia/Kolkata',
			day: 'numeric',
			month: 'short',
		});
		const who = row.updatedByName?.trim().split(/\s+/)[0];
		return who ? `${day} · ${who}` : day;
	}

	async copy(row: AdminShippingRuleSetRow) {
		try {
			const copy = await firstValueFrom(
				this.gateway.create({
					name: this.transloco.translate('ship_copy_name', { name: row.ruleSet.name }).slice(0, 80),
					description: row.ruleSet.description,
					use: row.ruleSet.use,
					copyFromId: row.ruleSet.id,
				}),
			);
			void this.queryClient.invalidateQueries({ queryKey: SHIPPING_KEY });
			void this.router.navigate(['/shipping/rule-sets', copy.ruleSet.id]);
		} catch (error) {
			this.notifier.showError(this.transloco.translate(shippingProblemKey(error)));
		}
	}

	async remove(row: AdminShippingRuleSetRow) {
		const yes = await askConfirm(this.modals, {
			icon: 'ri-delete-bin-line',
			title: 'ship_delete_rule_set_title',
			body: 'ship_delete_rule_set_body',
			params: { name: row.ruleSet.name },
			yes: 'delete',
		});
		if (!yes) return;
		this.gateway.remove(row.ruleSet.id, row.ruleSet.revision).subscribe({
			next: () => {
				this.notifier.showSuccess(this.transloco.translate('ship_rule_set_deleted'));
				void this.queryClient.invalidateQueries({ queryKey: SHIPPING_KEY });
			},
			error: (error: unknown) => this.notifier.showError(this.transloco.translate(shippingProblemKey(error))),
		});
	}
}
