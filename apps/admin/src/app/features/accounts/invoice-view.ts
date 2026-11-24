import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { gstStateName } from '@saha-textile/core-domain/company';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { INVOICE_KEYS, INVOICE_PRINTS, type InvoicePrint, InvoicesGateway } from '@core/accounts/invoices.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem, openPdf, saveBlob, StockQuantityPipe } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { rupees } from './ledger-helpers';

import type { InvoiceCheck } from '@saha-textile/contracts';

type InvoiceTab = 'details' | 'accounting' | 'checks' | 'log' | 'prints';

/**
 * A tax invoice as a document of the books (accounts brief D1, Q5 as drawn): its details, the lines it posted with
 * the checks it passed, its log and its prints. An invoice is never edited: a credit note corrects it (D2).
 */
@Component({
	selector: 'app-invoice-view',
	imports: [PageWrapper, TranslocoModule, RouterLink, NgbDropdownModule, StockQuantityPipe],
	templateUrl: './invoice-view.html',
})
export class InvoiceViewPage {
	private readonly gateway = inject(InvoicesGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly tabs: readonly InvoiceTab[] = ['details', 'accounting', 'checks', 'log', 'prints'];
	readonly tab = signal<InvoiceTab>('accounting');
	readonly prints = INVOICE_PRINTS;
	readonly busy = signal(false);
	readonly rupees = rupees;
	readonly inr = (value: number) => rupees(Math.round(value * 100));

	readonly invoice = injectQuery(() => ({
		queryKey: INVOICE_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.one(this.id())),
		enabled: !!this.id(),
	}));
	readonly accounting = injectQuery(() => ({
		queryKey: INVOICE_KEYS.accounting(this.id()),
		queryFn: () => firstValueFrom(this.gateway.accounting(this.id())),
		enabled: !!this.id(),
	}));
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	readonly locationName = computed(() => {
		const invoice = this.invoice.data();
		return this.locations.data()?.find((l) => l.id === invoice?.locationId)?.name ?? '';
	});

	/** The State's name with its code ("Maharashtra (27)"); 96 is outside India. */
	state(code: string): string {
		return code === '96'
			? this.transloco.translate('inv_outside_india')
			: `${gstStateName(code) ?? code} (${code})`;
	}

	day(iso: string): string {
		return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}

	when(iso: string): string {
		return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
	}

	/** "Nov 2026" for the period check. */
	month(yearMonth: string): string {
		return new Date(`${yearMonth}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
	}

	/** Each check's line under its name, in words. */
	detail(check: InvoiceCheck): string {
		const t = (key: string, params: Record<string, string> = {}) => this.transloco.translate(key, params);
		switch (check.key) {
			case 'period_open': {
				const month = check.params['month'];
				return month ? this.month(month) : '';
			}
			case 'number_in_series':
				return check.ok
					? check.params['previous']
						? t('inv_check_after', { previous: check.params['previous'] })
						: t('inv_check_first')
					: t('inv_check_gap');
			case 'place_of_supply':
				return t('inv_check_place_detail', check.params);
			case 'stock_at_cost':
				return check.ok ? t('inv_check_cost_detail', check.params) : t('inv_check_cost_missing');
			case 'rates':
				return t(check.ok ? 'inv_check_rates_ok' : 'inv_check_rates_wait');
			case 'cancel':
				return t(check.params['shipped'] === 'yes' ? 'inv_check_cancel_shipped' : 'inv_check_cancel_issued');
		}
	}

	async print(copy: InvoicePrint, save: boolean): Promise<void> {
		const invoice = this.invoice.data();
		if (!invoice) return;
		this.busy.set(true);
		try {
			const blob = await firstValueFrom(this.gateway.pdf(invoice.orderId, invoice.id, copy));
			if (save) saveBlob(`${invoice.number.replace(/\//g, '-')} ${copy}.pdf`, blob);
			else openPdf(blob);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
