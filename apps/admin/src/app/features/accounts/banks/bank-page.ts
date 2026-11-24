import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { BANK_KEYS, BanksGateway } from '@core/accounts/banks.gateway';
import { shortDate } from '@core/purchasing/purchasing-format';
import { accountsHint, accountsRange } from '@features/accounts/accounts-period';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Pagination } from '@shared/ui/pagination/pagination';
import { ACCOUNTS_PRESETS, PeriodPicker, type PeriodChoice } from '@shared/ui/period-picker/period-picker';

import { drCr } from './banks-list';
import { StatementImportPopup } from './statement-import-popup';

import type { BankLineQuery, BankLineStatus } from '@saha-textile/contracts';

export const BANK_TABS = ['lines', 'details'] as const;
export type BankTab = (typeof BANK_TABS)[number];
export const LINE_CHIPS = ['all', 'unmatched', 'suggested', 'accepted', 'rejected'] as const;
export type LineChip = (typeof LINE_CHIPS)[number];

/**
 * A bank account (accounts brief BA3): the lines imported from its statements (BA4–BA6) with Import a statement,
 * and its details; its statement in the books opens on the ledger page.
 */
@Component({
	selector: 'app-bank-page',
	imports: [PageWrapper, TranslocoModule, RouterLink, HasPermissionDirective, PeriodPicker, Pagination],
	templateUrl: './bank-page.html',
})
export class BankPage {
	private readonly gateway = inject(BanksGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly modals = inject(NgbModal);

	readonly tabs = BANK_TABS;
	readonly chips = LINE_CHIPS;
	readonly presets = ACCOUNTS_PRESETS;
	readonly hint = accountsHint;
	readonly pageSize = 50;

	readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly tab = signal<BankTab>('lines');
	readonly chip = signal<LineChip>('all');
	readonly range = signal(accountsRange({ period: 'current_quarter' }));
	readonly page = signal(1);

	readonly account = injectQuery(() => ({
		queryKey: BANK_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.one(this.id())),
		enabled: !!this.id(),
	}));
	readonly lines = injectQuery(() => {
		const query: Partial<BankLineQuery> = { ...this.range(), page: this.page(), pageSize: this.pageSize };
		const chip = this.chip();
		if (chip !== 'all') query.status = chip as BankLineStatus;
		return {
			queryKey: BANK_KEYS.lines(this.id(), query),
			queryFn: () => firstValueFrom(this.gateway.lines(this.id(), query)),
			enabled: !!this.id() && this.tab() === 'lines',
		};
	});

	balance(paise: number): string {
		return drCr(paise);
	}

	money(inr: number | null): string {
		return inr === null ? '—' : rupees(Math.round(inr * 100));
	}

	paise(value: number): string {
		return value ? rupees(value) : '';
	}

	day(date: string): string {
		return shortDate(date);
	}

	setChip(chip: LineChip): void {
		this.chip.set(chip);
		this.page.set(1);
	}

	setPeriod(choice: PeriodChoice): void {
		this.range.set(accountsRange(choice));
		this.page.set(1);
	}

	/** BA4: the popup reads the file; matching and checking happen on the import page. */
	async importStatement(): Promise<void> {
		const [list, layouts] = await Promise.all([
			firstValueFrom(this.gateway.list()),
			firstValueFrom(this.gateway.layouts()),
		]);
		const popup = this.modals.open(StatementImportPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'bank_import_title',
		});
		(popup.componentInstance as StatementImportPopup).start({
			accounts: list.items,
			bankAccountId: this.id(),
			layouts,
		});
	}
}
