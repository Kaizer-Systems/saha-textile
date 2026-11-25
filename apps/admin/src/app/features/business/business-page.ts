import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import {
	BUSINESSES_KEY,
	BusinessesGateway,
	injectBusinessBalancesQuery,
	injectBusinessLedgerQuery,
	injectBusinessQuery,
	injectZoneChoicesQuery,
} from '@core/business/businesses.gateway';
import { RupeesPipe, ShortDatePipe, rupees, shortDate } from '@core/purchasing/purchasing-format';
import { PurchasingGateway, injectSupplierSummaryQuery } from '@core/purchasing/purchasing.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { askReason } from '@features/purchasing/shared/popups';
import { exportSupplierStatement, recordSupplierPayment } from '@features/purchasing/shared/supplier-actions';
import { statementLink } from '@features/purchasing/supplier/supplier-page';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { ExportMenu, captured, type ExportSource } from '@shared/ui/export-menu/export-menu';

import { BusinessReceiptPopup } from './business-receipt-popup';
import { BusinessSetOffPopup } from './business-setoff-popup';
import { BusinessStandingPopup } from './business-standing-popup';

import type { LedgerStatementRow } from '@saha-textile/contracts';

export type BusinessTab = 'details' | 'customer' | 'supplier' | 'activity';

/** A statement as CSV for Export statement: date, document, debit, credit, balance, due. */
export function statementCsv(rows: readonly LedgerStatementRow[], heads: readonly string[]): string {
	const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
	const lines = rows.map((row) =>
		[
			row.at.slice(0, 10),
			row.documentNumber ?? row.kind,
			row.amountINR > 0 ? String(row.amountINR) : '',
			row.amountINR < 0 ? String(-row.amountINR) : '',
			String(row.balanceINR),
			row.dueOn ?? '',
		]
			.map(cell)
			.join(','),
	);
	return [heads.map(cell).join(','), ...lines].join('\n');
}

/**
 * One business (bz03, bz04): details, its customer account (orders on account, receipts, the running
 * balance with due dates), a link to its supplier statement, and the two balances side by side for
 * information only (K5: never set off here). Record a receipt, Export statement, Change standing.
 */
@Component({
	selector: 'app-business-page',
	templateUrl: './business-page.html',
	imports: [HasPermissionDirective, RouterModule, RupeesPipe, ShortDatePipe, TranslocoModule, ExportMenu],
})
export class BusinessPage {
	private readonly route = inject(ActivatedRoute);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = injectQueryClient();
	private readonly gateway = inject(BusinessesGateway);

	readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), { initialValue: null });
	readonly query = injectBusinessQuery(() => this.id());
	readonly business = computed(() => this.query.data() ?? null);
	readonly tab = signal<BusinessTab>('customer');
	readonly receivable = injectBusinessLedgerQuery(
		() => (this.business()?.roles.customer ? this.id() : null),
		() => 'receivable',
	);
	readonly payable = injectBusinessLedgerQuery(
		() => (this.business()?.roles.supplier ? this.id() : null),
		() => 'payable',
	);
	/** bz04: the supplier statement from Purchases › Suppliers, shown unchanged on the "As supplier" tab. */
	readonly supplierSummary = injectSupplierSummaryQuery(() =>
		this.business()?.roles.supplier && this.tab() === 'supplier' ? this.id() : null,
	);
	readonly statementLink = statementLink;
	private readonly purchasing = inject(PurchasingGateway);
	readonly zones = injectZoneChoicesQuery();
	readonly zoneName = computed(() => {
		const zoneId = this.business()?.roles.customer?.zoneId;
		return this.zones.data()?.find((zone) => zone.id === zoneId)?.name ?? zoneId ?? '';
	});

	readonly customer = computed(() => this.business()?.roles.customer ?? null);
	/** Where things stand (bz03, so04): what they owe us, and what we owe them (unpaid bills plus set-offs). */
	readonly balances = injectBusinessBalancesQuery(() => this.id());
	readonly owesUs = computed(() =>
		Math.max(0, this.balances.data()?.theyOweUsINR ?? this.receivable.data()?.closingINR ?? 0),
	);
	readonly weOwe = computed(() => Math.max(0, this.balances.data()?.weOweThemINR ?? 0));
	/** Set-offs already reversed (so04): their reversing entries point back at them. */
	readonly reversedIds = computed(
		() =>
			new Set(
				[...(this.receivable.data()?.rows ?? []), ...(this.payable.data()?.rows ?? [])]
					.map((row) => row.reversalOf)
					.filter((id): id is string => !!id),
			),
	);
	/** The supplier side's own entries (set-offs and reversals), "the same entry in the supplier account". */
	readonly supplierEntries = computed(() => this.payable.data()?.rows ?? []);
	/** Set-offs on the customer account that can still be reversed. */
	readonly setOffRows = computed(() => (this.receivable.data()?.rows ?? []).filter((row) => this.canReverse(row)));
	/** Never below ₹0: an account past its limit (an approved one-off) shows ₹0 available; Used says by how much. */
	readonly available = computed(() => Math.max(0, (this.customer()?.creditLimitINR ?? 0) - this.owesUs()));
	readonly usedPercent = computed(() => {
		const limit = this.customer()?.creditLimitINR ?? 0;
		return limit > 0 ? Math.min(100, (this.owesUs() / limit) * 100) : 0;
	});
	/** Activity: both accounts' entries, newest first. */
	readonly activity = computed(() =>
		[
			...(this.receivable.data()?.rows ?? []).map((row) => ({ ...row, sideKey: 'biz_side_customer' })),
			...(this.payable.data()?.rows ?? []).map((row) => ({ ...row, sideKey: 'biz_side_supplier' })),
		].sort((a, b) => b.at.localeCompare(a.at)),
	);

	/** bz04 Supplier account: the same Record payment and Export statement as Purchases › Suppliers. */
	async recordSupplierPayment(): Promise<void> {
		const id = this.id();
		if (!id) return;
		await recordSupplierPayment(id, {
			gateway: this.purchasing,
			modals: this.modals,
			notifier: this.notifier,
			queryClient: this.queryClient,
			t: (key) => this.transloco.translate(key),
		});
	}

	/** EX1: the supplier's statement for the Export menu (written by the statement's CSV code). */
	readonly supplierStatementSource = (): ExportSource | null => {
		const summary = this.supplierSummary.data();
		if (!summary) return null;
		const title = summary.supplier.shortName || summary.supplier.legalName;
		return captured(title, 'accounts', (save) =>
			exportSupplierStatement(summary, (key) => this.transloco.translate(key), save),
		);
	};

	exportSupplierStatement(): void {
		const summary = this.supplierSummary.data();
		if (summary) exportSupplierStatement(summary, (key) => this.transloco.translate(key));
	}

	day(value: string | null | undefined): string {
		return shortDate(value);
	}

	money(amount: number): string {
		return rupees(amount);
	}

	/** Receipts (RC) and journal vouchers (JV) print on their document formats. */
	printable(row: LedgerStatementRow): boolean {
		return row.documentType === 'receipt' || row.documentType === 'journal';
	}

	async printDocument(row: LedgerStatementRow): Promise<void> {
		const id = this.id();
		if (!id) return;
		const blob = await firstValueFrom(this.gateway.documentPdf(id, row.documentId)).catch(() => null);
		if (!blob) {
			this.notifier.showError(this.transloco.translate('print_failed'));
			return;
		}
		const url = URL.createObjectURL(blob);
		window.open(url, '_blank', 'noopener');
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	}

	documentWords(row: LedgerStatementRow): string {
		if (row.kind === 'setOff') {
			// so04: "Set-off JV/26-27/000001 against what we owe them · agreement STS/2026/04".
			const words = this.transloco.translate(
				row.side === 'receivable' ? 'biz_setoff_row_customer' : 'biz_setoff_row_supplier',
				{ number: row.documentNumber ?? '' },
			);
			const setting = this.business()?.setOff;
			const reference = row.agreement?.reference ?? (setting?.mode === 'agreement' ? setting.reference : null);
			return reference
				? `${words} · ${this.transloco.translate('biz_setoff_row_agreement', { reference })}`
				: words;
		}
		const kind = this.transloco.translate(`biz_entry_${row.kind}`);
		return row.documentNumber ? `${kind} · ${row.documentNumber}` : kind;
	}

	canReverse(row: LedgerStatementRow): boolean {
		return row.kind === 'setOff' && !this.reversedIds().has(row.id);
	}

	/** Record a set-off (so02, so03): at most the smaller balance, under an agreement. */
	async recordSetOff(): Promise<void> {
		const business = this.business();
		const balances = this.balances.data();
		if (!business || !balances) return;
		const popup = this.modals.open(BusinessSetOffPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'business_setoff_popup_title',
		});
		(popup.componentInstance as BusinessSetOffPopup).start(business, balances);
		if (await popup.result.catch(() => null)) await this.refresh('biz_setoff_saved');
	}

	/** so04: "Reverse this set-off" makes a reversing entry with its own reason, in both accounts. */
	async reverseSetOff(row: LedgerStatementRow): Promise<void> {
		const id = this.id();
		if (!id) return;
		const done = await askReason(this.modals, {
			title: 'biz_reverse_setoff',
			body: 'biz_reverse_setoff_body',
			params: { number: row.documentNumber ?? '' },
			label: 'biz_reason',
			confirm: 'biz_reverse_setoff',
			act: (reason) => firstValueFrom(this.gateway.reverseSetOff(id, row.documentId, { reason })),
		});
		if (done) await this.refresh('biz_setoff_reversed');
	}

	async recordReceipt(): Promise<void> {
		const business = this.business();
		if (!business) return;
		const popup = this.modals.open(BusinessReceiptPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'business_receipt_popup_title',
		});
		void (popup.componentInstance as BusinessReceiptPopup).start(business);
		if (await popup.result.catch(() => null)) await this.refresh('biz_receipt_saved');
	}

	async changeStanding(): Promise<void> {
		const business = this.business();
		if (!business?.roles.customer) return;
		const popup = this.modals.open(BusinessStandingPopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'business_standing_popup_title',
		});
		(popup.componentInstance as BusinessStandingPopup).start(business);
		if (await popup.result.catch(() => null)) await this.refresh('biz_standing_saved');
	}

	/** EX1: the business's statement for the Export menu, the same columns as its CSV. */
	readonly statementSource = (): ExportSource | null => {
		const business = this.business();
		const statement = this.receivable.data();
		if (!business || !statement) return null;
		const name = business.tradeName || business.legalName;
		return {
			fileName: `${name.replace(/[^\w-]+/g, '-')}-statement`,
			title: name,
			header: [
				'biz_col_date',
				'biz_col_document',
				'biz_col_debit',
				'biz_col_credit',
				'biz_col_balance',
				'biz_col_due',
			].map((key) => this.transloco.translate(key)),
			rows: statement.rows.map((row) => [
				row.at.slice(0, 10),
				row.documentNumber ?? row.kind,
				row.amountINR > 0 ? row.amountINR : null,
				row.amountINR < 0 ? -row.amountINR : null,
				row.balanceINR,
				row.dueOn ?? null,
			]),
			kinds: { 2: 'money', 3: 'money', 4: 'money' },
			area: 'accounts',
		};
	};

	exportStatement(): void {
		const business = this.business();
		const statement = this.receivable.data();
		if (!business || !statement) return;
		const heads = [
			'biz_col_date',
			'biz_col_document',
			'biz_col_debit',
			'biz_col_credit',
			'biz_col_balance',
			'biz_col_due',
		].map((key) => this.transloco.translate(key));
		const blob = new Blob([statementCsv(statement.rows, heads)], { type: 'text/csv;charset=utf-8' });
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = `${(business.tradeName || business.legalName).replace(/[^\w-]+/g, '-')}-statement.csv`;
		link.click();
		URL.revokeObjectURL(link.href);
	}

	private async refresh(message: string): Promise<void> {
		await this.queryClient.invalidateQueries({ queryKey: [...BUSINESSES_KEY] });
		this.notifier.showSuccess(this.transloco.translate(message));
	}
}
