import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { SETTLEMENT_KEYS, SettlementsGateway } from '@core/accounts/settlements.gateway';
import { shortDate } from '@core/purchasing/purchasing-format';
import { accountsHint, accountsRange } from '@features/accounts/accounts-period';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Pagination } from '@shared/ui/pagination/pagination';
import { ACCOUNTS_PRESETS, PeriodPicker, type PeriodChoice } from '@shared/ui/period-picker/period-picker';

import { SettlementImportPopup } from './settlement-import-popup';
import { SettlementView } from './settlement-view';

import type { Settlement, SettlementKind } from '@saha-textile/contracts';

export const SETTLEMENT_TABS: readonly SettlementKind[] = ['gateway', 'cod'];

/**
 * Settlements (accounts brief Q10): gateway payouts and courier COD remittances by period, each with its orders,
 * money and how many rows matched an order payment; Import payout file; and gateway payments no payout has paid
 * after 7 days, flagged.
 */
@Component({
	selector: 'app-settlements-page',
	imports: [PageWrapper, TranslocoModule, HasPermissionDirective, PeriodPicker, Pagination],
	templateUrl: './settlements-page.html',
})
export class SettlementsPage {
	private readonly gateway = inject(SettlementsGateway);
	private readonly modals = inject(NgbModal);
	private readonly queries = inject(QueryClient);

	readonly tabs = SETTLEMENT_TABS;
	readonly presets = ACCOUNTS_PRESETS;
	readonly hint = accountsHint;
	readonly pageSize = 20;

	readonly kind = signal<SettlementKind>('gateway');
	readonly range = signal(accountsRange({ period: 'this_month' }));
	readonly page = signal(1);
	readonly query = injectQuery(() => {
		const query = { kind: this.kind(), ...this.range(), page: this.page(), pageSize: this.pageSize };
		return {
			queryKey: SETTLEMENT_KEYS.list(query),
			queryFn: () => firstValueFrom(this.gateway.list(query)),
		};
	});
	readonly rows = computed(() => this.query.data()?.items ?? []);

	setKind(kind: SettlementKind): void {
		this.kind.set(kind);
		this.page.set(1);
	}

	setPeriod(choice: PeriodChoice): void {
		this.range.set(accountsRange(choice));
		this.page.set(1);
	}

	rupees(paise: number): string {
		return rupees(paise);
	}

	day(date: string): string {
		return shortDate(date);
	}

	/** Every row of the payout matched to an order payment, or some not. */
	allMatched(row: Settlement): boolean {
		return row.matched === row.rows.length;
	}

	async importFile(): Promise<void> {
		const popup = this.modals.open(SettlementImportPopup, {
			centered: true,
			size: 'xl',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'stl_import_title',
		});
		(popup.componentInstance as SettlementImportPopup).start(this.kind());
		const done = await popup.result.catch(() => false);
		if (done) await this.queries.invalidateQueries({ queryKey: SETTLEMENT_KEYS.all });
	}

	/** The payout's rows; with `print`, printed through the browser once shown. */
	open(row: Settlement, print = false): void {
		const popup = this.modals.open(SettlementView, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'stl_view_title',
		});
		(popup.componentInstance as SettlementView).start(row, print);
	}
}
