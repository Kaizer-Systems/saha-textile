import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ASSET_KEYS, AssetsGateway } from '@core/accounts/assets.gateway';
import { shortDate } from '@core/purchasing/purchasing-format';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { FixedAsset } from '@saha-textile/contracts';

/** An asset's book value now (paise). */
export function bookValue(asset: Pick<FixedAsset, 'costINR' | 'accumulatedPaise'>): number {
	return Math.round(asset.costINR * 100) - asset.accumulatedPaise;
}

/** Fixed assets (accounts brief R1): the register with cost, depreciation taken and book value, active or disposed. */
@Component({
	selector: 'app-assets-register',
	imports: [PageWrapper, TranslocoModule, RouterLink],
	templateUrl: './assets-register.html',
})
export class AssetsRegisterPage {
	private readonly gateway = inject(AssetsGateway);

	readonly money = rupees;
	readonly value = bookValue;
	readonly chip = signal<'active' | 'disposed'>('active');
	readonly assets = injectQuery(() => ({
		queryKey: ASSET_KEYS.list,
		queryFn: () => firstValueFrom(this.gateway.list()),
	}));
	readonly rows = computed(() => (this.assets.data() ?? []).filter((a) => a.status === this.chip()));
	readonly counts = computed(() => ({
		active: (this.assets.data() ?? []).filter((a) => a.status === 'active').length,
		disposed: (this.assets.data() ?? []).filter((a) => a.status === 'disposed').length,
	}));

	day(date: string): string {
		return shortDate(date);
	}
}
