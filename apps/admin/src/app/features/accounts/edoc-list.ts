import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { EDOC_KEYS, EDocsGateway } from '@core/edocs/edocs.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';

import type { DashboardPeriodQuery, EDocument } from '@saha-textile/contracts';

type Tab = 'active' | 'endsSoon' | 'ended' | 'cancelled';
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The date range of a period choice (the shared period picker's presets). */
export function periodRange(q: DashboardPeriodQuery, now = new Date()): { from?: string; to?: string } {
	const y = now.getFullYear();
	const m = now.getMonth();
	const quarterStart = m - (m % 3);
	switch (q.period) {
		case 'custom':
			return { from: q.from, to: q.to };
		case 'last_30_days':
			return { from: iso(new Date(now.getTime() - 29 * DAY)), to: iso(now) };
		case 'last_month':
			return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
		case 'current_quarter':
			return { from: iso(new Date(Date.UTC(y, quarterStart, 1))), to: iso(now) };
		case 'last_quarter':
			return {
				from: iso(new Date(Date.UTC(y, quarterStart - 3, 1))),
				to: iso(new Date(Date.UTC(y, quarterStart, 0))),
			};
		default:
			return { from: iso(new Date(Date.UTC(y - 1, m, now.getDate() + 1))), to: iso(now) };
	}
}

/**
 * Accounts › E-invoices and Accounts › E-way bills (accounts brief addendum 2, EI12–EI13; AE1–AE9 approved
 * 2026-11-23): every IRN or e-way bill, how it was made, with the period and a search. "Needed" and
 * "Failed" arrive with the tax invoices issued at dispatch (D1), which they count from.
 */
@Component({
	selector: 'app-edoc-list',
	imports: [PageWrapper, TranslocoModule, FormsModule, PeriodPicker, DatePipe, DecimalPipe],
	templateUrl: './edoc-list.html',
})
export class EDocListPage {
	private readonly gateway = inject(EDocsGateway);
	readonly kind = toSignal(
		inject(ActivatedRoute).data.pipe(map((d) => (d['kind'] as 'eInvoice' | 'eWayBill') ?? 'eInvoice')),
		{
			initialValue: 'eInvoice' as const,
		},
	);
	readonly tab = signal<Tab>('active');
	readonly search = signal('');
	readonly range = signal<{ from?: string; to?: string }>(periodRange({ period: 'last_12_months' }));
	readonly page = signal(1);
	readonly tabs = computed<Tab[]>(() =>
		this.kind() === 'eInvoice' ? ['active', 'cancelled'] : ['active', 'endsSoon', 'ended', 'cancelled'],
	);

	readonly query = injectQuery(() => ({
		queryKey: [...EDOC_KEYS.documents(this.kind()), this.tab(), this.search(), this.range(), this.page()],
		queryFn: () =>
			firstValueFrom(
				this.gateway.documents({
					kind: this.kind(),
					status: this.tab() === 'cancelled' ? 'cancelled' : 'active',
					...this.range(),
					...(this.search().trim() ? { q: this.search().trim() } : {}),
					page: this.page(),
				}),
			),
	}));

	/** E-way bills: Active, Ends within a day and Ended are the same records split by validity. */
	readonly rows = computed(() => {
		const rows = this.query.data()?.rows ?? [];
		if (this.kind() !== 'eWayBill' || this.tab() === 'cancelled') return rows;
		const now = Date.now();
		const ends = (r: EDocument) => (r.validUntil ? new Date(r.validUntil).getTime() : Infinity);
		if (this.tab() === 'endsSoon') return rows.filter((r) => ends(r) > now && ends(r) - now <= DAY);
		if (this.tab() === 'ended') return rows.filter((r) => ends(r) <= now);
		return rows.filter((r) => ends(r) > now);
	});
	readonly pages = computed(() => Math.max(1, Math.ceil((this.query.data()?.total ?? 0) / 25)));

	setTab(tab: Tab): void {
		this.tab.set(tab);
		this.page.set(1);
	}

	setPeriod(q: DashboardPeriodQuery): void {
		this.range.set(periodRange(q));
		this.page.set(1);
	}

	shortIrn(irn: string | null): string {
		return irn ? `${irn.slice(0, 4)}…${irn.slice(-4)}` : '—';
	}
}
