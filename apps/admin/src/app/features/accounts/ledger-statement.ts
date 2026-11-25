import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { ExportMenu, type ExportSource } from '@shared/ui/export-menu/export-menu';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';

import { periodRange } from './edoc-list';
import { drCr, rupees } from './ledger-helpers';

import type { DashboardPeriodQuery } from '@saha-textile/contracts';

const PAGE = 25;
const today = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Accounts › Ledgers › one ledger (accounts brief Q2, as drawn): opening, every entry with its voucher and a
 * running balance, closing; filtered by period and location, searchable, exported through the Export menu.
 */
@Component({
	selector: 'app-ledger-statement',
	imports: [PageWrapper, TranslocoModule, FormsModule, PeriodPicker, RouterLink, ExportMenu],
	templateUrl: './ledger-statement.html',
})
export class LedgerStatementPage {
	private readonly gateway = inject(LedgerGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly transloco = inject(TranslocoService);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	/** Starts on the period picker's own default (last 12 months), so the picker and the rows agree. */
	readonly range = signal<{ from: string; to: string }>({
		from: periodRange({ period: 'last_12_months' }).from as string,
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
		this.range.set({ from: r.from ?? `${today().slice(0, 8)}01`, to: r.to ?? today() });
		this.page.set(1);
	}

	/** The Export menu's rows: every entry matching the search, with the location's name (brief 25 EX1). */
	readonly exportSource = (): ExportSource | null => {
		const data = this.statement.data();
		if (!data) return null;
		const t = (key: string) => this.transloco.translate(key);
		const location = this.locationId();
		return {
			fileName: `${data.ledger.name}-${data.from}-${data.to}`,
			title: `${t('accounts_ledger')}: ${data.ledger.name}`,
			area: 'accounts',
			filters: [
				{ label: t('al_period'), value: `${data.from} – ${data.to}` },
				...(location ? [{ label: t('location'), value: this.locationName(location) }] : []),
				...(this.search().trim() ? [{ label: t('search'), value: this.search().trim() }] : []),
			],
			header: [
				t('date'),
				t('accounts_voucher'),
				t('accounts_particulars'),
				t('location'),
				t('accounts_debit'),
				t('accounts_credit'),
				t('accounts_balance'),
			],
			rows: this.rows().map((r) => [
				r.date,
				r.number,
				r.narration,
				this.locationName(r.locationId),
				r.debitPaise / 100,
				r.creditPaise / 100,
				r.balancePaise / 100,
			]),
			kinds: { 4: 'money', 5: 'money', 6: 'money' },
		};
	};
}
