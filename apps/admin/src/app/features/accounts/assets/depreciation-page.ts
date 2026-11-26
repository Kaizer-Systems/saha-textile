import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ASSET_KEYS, AssetsGateway } from '@core/accounts/assets.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

/** This month in India, `YYYY-MM`. */
export function thisMonth(now = new Date()): string {
	return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 7);
}

/** Depreciation for a month (accounts brief R3): each asset's amount and book value after, posted once as one journal. */
@Component({
	selector: 'app-depreciation-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, HasPermissionDirective],
	templateUrl: './depreciation-page.html',
})
export class DepreciationPage {
	private readonly gateway = inject(AssetsGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly money = rupees;
	readonly month = signal(thisMonth());
	readonly busy = signal(false);
	readonly run = injectQuery(() => ({
		queryKey: ASSET_KEYS.run(this.month()),
		queryFn: () => firstValueFrom(this.gateway.preview(this.month())),
		enabled: /^\d{4}-\d{2}$/.test(this.month()),
	}));

	async post(): Promise<void> {
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.post(this.month()));
			this.notifier.showSuccess(this.transloco.translate('assets_depreciation_posted'));
			await this.queries.invalidateQueries({ queryKey: ASSET_KEYS.all });
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`assets_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
