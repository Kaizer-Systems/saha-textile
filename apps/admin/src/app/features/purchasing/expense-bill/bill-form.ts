import { Component, computed, effect, inject, signal, type TemplateRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { expenseBillTotals } from '@saha-textile/core-domain/expense-bills';
import { istDay } from '@saha-textile/core-domain/purchasing';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { Select2, type Select2Data, type Select2SearchEvent, type Select2UpdateEvent } from 'ng-select2-component';
import { firstValueFrom, map } from 'rxjs';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { EXPENSE_BILL_KEYS, ExpenseBillsGateway, expenseBillProblemKey } from '@core/purchasing/expense-bills.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { injectSuppliersQuery } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { bankLedgers } from '@features/accounts/cash-bank-ledgers';
import { rupees } from '@features/accounts/ledger-helpers';
import { GST_RATES } from '@features/purchasing/purchase-entry/entry-lines';
import { PAYMENT_MODES, parseRupees } from '@features/purchasing/shared/payment-popup';
import { askReason } from '@features/purchasing/shared/popups';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type {
	ExpenseBill,
	ExpenseBillLine,
	ExpenseBillWrite,
	ExpenseCredit,
	Ledger,
	PaymentMode,
	SupplierListRow,
} from '@saha-textile/contracts';

/** One line as the form holds it while typing; the taxable value stays text until it is read. */
export interface ExpenseFormLine {
	expenseLedgerId: string;
	what: string;
	sac: string;
	taxable: string;
	gstRatePct: number;
	credit: ExpenseCredit;
	blockedClause: string;
}

export const blankExpenseLine = (): ExpenseFormLine => ({
	expenseLedgerId: '',
	what: '',
	sac: '',
	taxable: '',
	gstRatePct: 18,
	credit: 'claim',
	blockedClause: '',
});

/** The line as the API takes it; a value that can't be read counts as ₹0 (the form won't save it). */
export function expenseLineWrite(line: ExpenseFormLine, composition: boolean): ExpenseBillLine {
	const blocked = composition || line.credit === 'blocked';
	return {
		expenseLedgerId: line.expenseLedgerId,
		what: line.what.trim(),
		sac: line.sac.trim(),
		taxableINR: parseRupees(line.taxable) ?? 0,
		gstRatePct: line.gstRatePct,
		credit: blocked ? 'blocked' : 'claim',
		blockedClause: blocked ? line.blockedClause.trim() : '',
	};
}

/**
 * Purchases › Expense bills › New (brief 25 EB1, as drawn): the supplier, their bill number and date, the location
 * (and GSTIN) it is billed to, and a line per expense with its SAC, taxable value, GST rate and whether the credit is
 * claimed or blocked (s.17(5)). The tax is worked out as typed: CGST and SGST within the State, IGST from another;
 * blocked tax joins the expense. Save draft keeps it; Post numbers it (EB) and books it. A posted bill is read-only
 * here, with Cancel, which books the opposite.
 */
@Component({
	selector: 'app-expense-bill-form',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, Select2],
	templateUrl: './bill-form.html',
})
export class ExpenseBillFormPage {
	private readonly gateway = inject(ExpenseBillsGateway);
	private readonly router = inject(Router);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);
	private readonly modals = inject(NgbModal);
	private readonly queries = inject(QueryClient);
	private readonly ledgers = inject(LedgerGateway);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly today = istDay(new Date());
	readonly rates = GST_RATES;
	readonly supplierId = signal('');
	readonly billNumber = signal('');
	readonly billDate = signal(this.today);
	readonly locationId = signal('');
	readonly note = signal('');
	readonly lines = signal<ExpenseFormLine[]>([blankExpenseLine()]);
	readonly busy = signal(false);
	private readonly version = signal<number | null>(null);
	readonly inr = (value: number) => rupees(Math.round(value * 100));

	readonly bill = injectQuery(() => ({
		queryKey: EXPENSE_BILL_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.get(this.id())),
		enabled: !!this.id(),
	}));
	readonly vouchers = injectQuery(() => ({
		queryKey: EXPENSE_BILL_KEYS.vouchers(this.id()),
		queryFn: () => firstValueFrom(this.gateway.paymentVouchers(this.id())),
		enabled: !!this.id(),
	}));
	readonly options = injectQuery(() => ({
		queryKey: EXPENSE_BILL_KEYS.form,
		queryFn: () => firstValueFrom(this.gateway.form()),
	}));

	/* supplier picker, as the purchase entry form has it */
	readonly supplierSearch = signal('');
	private readonly suppliersQuery = injectSuppliersQuery(() => ({
		filter: 'all',
		page: 1,
		pageSize: 30,
		...(this.supplierSearch() ? { q: this.supplierSearch() } : {}),
	}));
	private readonly known = signal<ReadonlyMap<string, SupplierListRow>>(new Map());
	readonly supplier = computed(() => this.known().get(this.supplierId()) ?? null);
	readonly supplierOptions = computed<Select2Data>(() => {
		const rows = (this.suppliersQuery.data()?.items ?? []).filter(
			(row) => row.active || row.id === this.supplierId(),
		);
		const chosen = this.supplier();
		if (chosen && !rows.some((row) => row.id === chosen.id)) rows.unshift(chosen);
		return rows.map((row) => ({ value: row.id, label: row.shortName || row.legalName }));
	});

	constructor() {
		effect(() => {
			const rows = this.suppliersQuery.data()?.items ?? [];
			if (!rows.length) return;
			this.known.update((known) => {
				const next = new Map(known);
				for (const row of rows) next.set(row.id, row);
				return next;
			});
		});
		effect(() => {
			const bill = this.bill.data();
			if (bill && this.version() !== bill.version) this.fill(bill);
		});
	}

	/** A saved bill opened again: its own values on the form. */
	fill(bill: ExpenseBill): void {
		this.supplierId.set(bill.supplierId);
		this.supplierSearch.set(bill.supplierName);
		this.billNumber.set(bill.billNumber);
		this.billDate.set(bill.billDate);
		this.locationId.set(bill.locationId);
		this.note.set(bill.note);
		this.lines.set(
			bill.lines.map((line) => ({
				expenseLedgerId: line.expenseLedgerId,
				what: line.what,
				sac: line.sac,
				taxable: String(line.taxableINR),
				gstRatePct: line.gstRatePct,
				credit: line.credit,
				blockedClause: line.blockedClause,
			})),
		);
		this.version.set(bill.version);
	}

	readonly status = computed(() => this.bill.data()?.status ?? 'draft');
	readonly readOnly = computed(() => this.status() !== 'draft');
	readonly location = computed(() => this.options.data()?.locations.find((l) => l.id === this.locationId()) ?? null);
	readonly composition = computed(() => this.location()?.composition ?? false);
	readonly interState = computed(() => {
		const gstin = this.supplier()?.gstin;
		const location = this.location();
		return !!gstin && !!location && gstin.slice(0, 2) !== location.stateCode;
	});
	readonly writeLines = computed(() => this.lines().map((line) => expenseLineWrite(line, this.composition())));
	readonly totals = computed(() => expenseBillTotals(this.writeLines(), this.interState()));
	/** Reverse charge from someone without a GSTIN is a self-invoice, not this bill. */
	readonly needsSelfInvoice = computed(
		() => !!this.supplier() && !this.supplier()?.gstin && this.writeLines().some((l) => l.gstRatePct > 0),
	);
	readonly canEdit = computed(() => this.auth.permissions().includes('accounts.edit'));
	readonly canPost = computed(() => this.auth.permissions().includes('accounts.post'));
	readonly linesReady = computed(() =>
		this.writeLines().every(
			(l, i) => !!l.expenseLedgerId && !!l.what && parseRupees(this.lines()[i]?.taxable ?? '') !== null,
		),
	);
	readonly ready = computed(
		() =>
			this.canEdit() &&
			!this.readOnly() &&
			!this.busy() &&
			!!this.supplier() &&
			!!this.billNumber().trim() &&
			!!this.billDate() &&
			this.billDate() <= this.today &&
			!!this.location() &&
			this.linesReady() &&
			!this.needsSelfInvoice(),
	);

	/** "18%: CGST 2,250.00 · SGST 2,250.00", or IGST; nothing at 0%. */
	lineTax(index: number): string {
		const line = this.writeLines()[index];
		if (!line || !line.gstRatePct) return '—';
		const tax = (line.taxableINR * line.gstRatePct) / 100;
		if (this.interState()) return `${line.gstRatePct}%: IGST ${this.inr(tax)}`;
		return `${line.gstRatePct}%: CGST ${this.inr(tax / 2)} · SGST ${this.inr(tax / 2)}`;
	}

	setLine(index: number, change: Partial<ExpenseFormLine>): void {
		this.lines.update((lines) => lines.map((line, i) => (i === index ? { ...line, ...change } : line)));
	}

	addLine(): void {
		this.lines.update((lines) => [...lines, blankExpenseLine()]);
	}

	removeLine(index: number): void {
		this.lines.update((lines) => (lines.length > 1 ? lines.filter((_, i) => i !== index) : lines));
	}

	searchSuppliers(event: Select2SearchEvent): void {
		this.supplierSearch.set(event.search ?? '');
	}

	chooseSupplier(event: Select2UpdateEvent): void {
		this.supplierId.set(typeof event.value === 'string' ? event.value : '');
	}

	write(): ExpenseBillWrite {
		return {
			supplierId: this.supplierId(),
			billNumber: this.billNumber().trim(),
			billDate: this.billDate(),
			locationId: this.locationId(),
			lines: this.writeLines(),
			note: this.note().trim(),
		};
	}

	private async persist(): Promise<ExpenseBill> {
		const id = this.id();
		const version = this.version();
		const saved = await firstValueFrom(
			id && version !== null ? this.gateway.update(id, this.write(), version) : this.gateway.create(this.write()),
		);
		this.version.set(saved.version);
		return saved;
	}

	private async run(work: () => Promise<void>): Promise<void> {
		this.busy.set(true);
		try {
			await work();
		} catch (error) {
			this.notifier.showError(this.problem(error));
		} finally {
			this.busy.set(false);
		}
	}

	/** A refusal in words: the bill's own, the books', or the message as it came. */
	problem(error: unknown): string {
		const message = apiProblem(error, this.transloco.translate('purchasing_action_failed'));
		const known = expenseBillProblemKey(message);
		return known ? this.transloco.translate(known.key, known.params) : message;
	}

	private async settle(bill: ExpenseBill): Promise<void> {
		this.queries.setQueryData(EXPENSE_BILL_KEYS.one(bill.id), bill);
		await this.queries.invalidateQueries({ queryKey: EXPENSE_BILL_KEYS.all });
	}

	save(): Promise<void> {
		return this.run(async () => {
			const saved = await this.persist();
			await this.settle(saved);
			this.notifier.showSuccess(this.transloco.translate('eb_saved'));
			if (!this.id()) await this.router.navigate(['/expense-bills', saved.id]);
		});
	}

	post(): Promise<void> {
		return this.run(async () => {
			const saved = await this.persist();
			const posted = await firstValueFrom(this.gateway.post(saved.id));
			await this.settle(posted);
			this.notifier.showSuccess(this.transloco.translate('eb_posted', { number: posted.number }));
			if (!this.id()) await this.router.navigate(['/expense-bills', posted.id]);
		});
	}

	/* Pay (the self-invoice page's pop-up, as purchase bills are paid): a payment voucher is issued with it. */
	readonly modes = PAYMENT_MODES;
	readonly amount = signal('');
	readonly paidOn = signal(this.today);
	readonly mode = signal<PaymentMode>('bank_transfer');
	readonly reference = signal('');
	readonly paidFrom = signal('');
	readonly banks = signal<Ledger[]>([]);
	private modal: NgbModalRef | null = null;

	readonly owed = computed(() => {
		const bill = this.bill.data();
		return bill ? Math.round((bill.totalINR - bill.paidINR) * 100) / 100 : 0;
	});
	readonly canPay = computed(
		() => this.status() === 'posted' && this.owed() > 0 && this.auth.permissions().includes('purchase.payment'),
	);
	readonly amountValue = computed(() => parseRupees(this.amount()));
	/** "Paid from" shows only when a transfer could come from more than one bank. */
	readonly choosesBank = computed(() => this.mode() !== 'cash' && this.banks().length > 1);
	readonly canConfirm = computed(() => {
		const value = this.amountValue();
		return (
			!this.busy() &&
			value !== null &&
			value > 0 &&
			value <= this.owed() + 0.005 &&
			!!this.paidOn() &&
			(!this.choosesBank() || !!this.paidFrom())
		);
	});
	readonly settles = computed(() => (this.amountValue() ?? 0) >= this.owed() - 0.005);

	async openPay(template: TemplateRef<unknown>): Promise<void> {
		this.amount.set(String(this.owed()));
		this.paidOn.set(this.today);
		this.mode.set('bank_transfer');
		this.reference.set('');
		this.paidFrom.set('');
		if (!this.banks().length) this.banks.set(bankLedgers(await firstValueFrom(this.ledgers.chart())));
		this.modal = this.modals.open(template, { centered: true });
	}

	pay(bill: ExpenseBill): Promise<void> {
		return this.run(async () => {
			const { bill: paid, voucher } = await firstValueFrom(
				this.gateway.pay(bill.id, {
					amountINR: this.amountValue() ?? 0,
					paidOn: this.paidOn(),
					mode: this.mode(),
					reference: this.reference().trim() || null,
					paidFromLedgerId: this.choosesBank() ? this.paidFrom() : null,
					version: bill.version,
				}),
			);
			this.modal?.close();
			await this.settle(paid);
			this.notifier.showSuccess(this.transloco.translate('eb_paid_done', { number: voucher.number }));
		});
	}

	async cancel(): Promise<void> {
		const bill = this.bill.data();
		if (!bill) return;
		const done = await askReason(this.modals, {
			title: 'eb_cancel_title',
			body: bill.status === 'posted' ? 'eb_cancel_body_posted' : 'eb_cancel_body_draft',
			params: { number: bill.number ?? bill.billNumber },
			label: 'reason',
			confirm: 'eb_cancel',
			confirmClass: 'btn-danger',
			act: async (reason) => {
				try {
					return await firstValueFrom(this.gateway.cancel(bill.id, reason));
				} catch (error) {
					// The pop-up shows the first issue's message: hand it the refusal in words.
					throw { error: { message: this.problem(error) } };
				}
			},
		});
		if (done && typeof done === 'object') {
			await this.settle(done as ExpenseBill);
			this.notifier.showSuccess(this.transloco.translate('eb_cancelled'));
		}
	}
}
