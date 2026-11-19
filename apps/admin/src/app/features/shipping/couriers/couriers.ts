import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { injectShippingOverviewQuery } from '@core/shipping/shipping.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { ShippingZone } from '@saha-textile/contracts';

/** Couriers that have an adapter slot (brief cr01). None is connected; each is an adapter for later. */
const COURIERS = [
	{ key: 'shiprocket', name: 'Shiprocket', zones: 'both' },
	{ key: 'delhivery', name: 'Delhivery', zones: 'domestic' },
	{ key: 'bluedart', name: 'Blue Dart', zones: 'domestic' },
	{ key: 'dhl', name: 'DHL Express', zones: 'international' },
] as const;

/**
 * Admin › Shipping › Couriers (brief cr01). Nothing is connected: each courier is an adapter behind
 * the shipping port, and connecting one adds "Courier quote" as a choice for either zone, with a
 * rule set to fall back on. Until then each zone is priced by its rule set, chosen on Where rules apply.
 */
@Component({
	selector: 'app-shipping-couriers',
	templateUrl: './couriers.html',
	imports: [PageWrapper, RouterLink, TranslocoModule],
})
export class ShippingCouriers {
	readonly query = injectShippingOverviewQuery();
	readonly couriers = COURIERS;
	readonly zones: ShippingZone[] = ['domestic', 'international'];

	ruleSetName(zone: ShippingZone): string | null {
		const data = this.query.data();
		const method = (data?.settings ?? data?.defaults)?.[zone];
		const id = method?.kind === 'ruleSet' ? method.ruleSetId : (method?.fallbackRuleSetId ?? null);
		return id ? (data?.ruleSets.find((r) => r.id === id)?.name ?? null) : null;
	}
}
