import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import {
	SHIPPING_KEY,
	ShippingGateway,
	injectShippingRuleSetsQuery,
	shippingProblemKey,
} from '@core/shipping/shipping.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type { ShippingRuleSetUse } from '@saha-textile/contracts';

/** Icons for the pre-made cards, by key (brief rb01). */
const ICONS: Record<string, string> = {
	'add-per-unit': 'ri-stack-line',
	'highest-only': 'ri-arrow-up-circle-line',
	'first-and-further': 'ri-number-1',
	'free-above': 'ri-gift-line',
	'weight-bands': 'ri-scales-3-line',
	'flat-per-order': 'ri-price-tag-3-line',
	'courier-quote': 'ri-truck-line',
};

/**
 * Admin › Shipping › Rule sets › New (brief rb01): a name, what it is for, and where to start —
 * blank, or a copy of a pre-made rule set. The copy is the shop's own; the original never changes.
 */
@Component({
	selector: 'app-new-rule-set',
	templateUrl: './new-rule-set.html',
	imports: [PageWrapper, FormFields, FormsModule, RouterLink, TranslocoModule],
})
export class NewRuleSet {
	private readonly gateway = inject(ShippingGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly router = inject(Router);

	readonly query = injectShippingRuleSetsQuery();
	readonly name = signal('');
	readonly use = signal<ShippingRuleSetUse>('domestic');
	/** The rule set to copy; null starts blank. */
	readonly from = signal<string | null>(null);
	readonly busy = signal(false);
	readonly uses: ShippingRuleSetUse[] = ['domestic', 'international', 'both'];

	readonly premades = computed(() =>
		(this.query.data() ?? []).filter((row) => row.ruleSet.kind === 'premade').map((row) => row.ruleSet),
	);

	icon(key: string | null): string {
		return (key && ICONS[key]) || 'ri-file-list-3-line';
	}

	async create() {
		const name = this.name().trim();
		if (!name || this.busy()) return;
		this.busy.set(true);
		try {
			const created = await firstValueFrom(
				this.gateway.create({ name, description: '', use: this.use(), copyFromId: this.from() }),
			);
			void this.queryClient.invalidateQueries({ queryKey: SHIPPING_KEY });
			void this.router.navigate(['/shipping/rule-sets', created.ruleSet.id]);
		} catch (error) {
			this.notifier.showError(this.transloco.translate(shippingProblemKey(error)));
		} finally {
			this.busy.set(false);
		}
	}
}
