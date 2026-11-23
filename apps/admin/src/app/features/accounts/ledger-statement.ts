import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';

import { periodRange } from './edoc-list';
import { drCr, rupees } from './ledger-helpers';

import type { DashboardPeriodQuery } from '@saha-textile/contracts';

const PAGE = 25;
const monthStart = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 8) + '01';
const today = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Accounts › Ledgers › one ledger (accounts brief Q2, as drawn): opening, every entry with its voucher and a
 * running balance, closing; filtered by period and location, searchable, exported as a spreadsheet file.
 */
@Component({
	selector: 'app-ledger-statement',
	imports: [PageWrapper, TranslocoModule, FormsModule, PeriodPicker, RouterLink],
	templateUrl: './ledger-statement.html',
})
export class LedgerStatementPage {
	private readonly gateway = inject(LedgerGateway);
	private readonly locationsGateway = inject(LocationsGateway);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	/** Starts on the period picker's own default (last 12 months), so the picker and the rows agree. */
	readonly range = signal<{ from: string; to: string }>({
		from: periodRange({ period: 'last_12_months' }).from ?? monthStart(),
		to: today(),
	});
	readonly locationId = signal('');
	readonly search = signal('');
	readonly page = signal(1);
	readonly drCr = drCr;
	readonly rupees = rupees;

	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	readonly statement = injectQuery(() => ({
		queryKey: [...LEDGER_KEYS.statement(this.id()), this.range(), this.locationId()],
		queryFn: () =>
			firstValueFrom(
				this.gateway.statement(
					this.id(),
					this.range().from,
					this.range().to,
					this.locationId() ? [this.locationId()] : [],
				),
			),
		enabled: !!this.id(),
	}));
	readonly chart = injectQuery(() => ({
		queryKey: LEDGER_KEYS.chart,
		queryFn: () => firstValueFrom(this.gateway.chart()),
	}));
	readonly groupName = computed(() => {
		const ledger = this.statement.data()?.ledger;
		return this.chart.data()?.groups.find((g) => g.id === ledger?.groupId)?.name ?? '';
	});
	readonly rows = computed(() => {
		const q = this.search().trim().toLowerCase();
		const rows = this.statement.data()?.rows ?? [];
		return q ? rows.filter((r) => `${r.number} ${r.narration}`.toLowerCase().includes(q)) : rows;
	});
	readonly pages = computed(() => Math.max(1, Math.ceil(this.rows().length / PAGE)));
	readonly shown = computed(() => this.rows().slice((this.page() - 1) * PAGE, this.page() * PAGE));
	readonly locationName = (id: string) => this.locations.data()?.find((l) => l.id === id)?.name ?? '';

	setPeriod(q: DashboardPeriodQuery): void {
		const r = periodRange(q);
		this.range.set({ from: r.from ?? monthStart(), to: r.to ?? today() });
		this.page.set(1);
	}

	/** Export: the rows in view as a CSV file (opens in Excel). */
	export(): void {
		const data = this.statement.data();
		if (!data) return;
		const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
		const lines = [
			['Date', 'Voucher', 'Particulars', 'Location', 'Debit', 'Credit', 'Balance'].map(cell).join(','),
			...this.rows().map((r) =>
				[
					r.date,
					r.number,
					r.narration,
					this.locationName(r.locationId),
					r.debitPaise / 100,
					r.creditPaise / 100,
					r.balancePaise / 100,
				]
					.map(cell)
					.join(','),
			),
		];
		const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `${data.ledger.name}-${data.from}-${data.to}.csv`;
		link.click();
		URL.revokeObjectURL(url);
	}
}
