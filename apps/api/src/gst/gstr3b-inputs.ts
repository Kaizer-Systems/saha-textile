import { Inject, Injectable } from '@nestjs/common';
import { VoucherKind, type JournalVoucher } from '@saha-textile/contracts';
import {
	claimFrom2b,
	day180,
	defaultStockLocation,
	resolveRole,
	reversedInBooks,
	rule37,
	type GeneralLedgerRepository,
	type Gstr3bInput,
	type LocationRepository,
	type PurchaseEntryRepository,
	type Rule37Bill,
	type SelfInvoiceRepository,
	type SupplierPaymentRepository,
	type TaxHeads,
} from '@saha-textile/core-domain';

import {
	GENERAL_LEDGER_REPOSITORY,
	LOCATION_REPOSITORY,
	PURCHASE_ENTRY_REPOSITORY,
	SELF_INVOICE_REPOSITORY,
	SUPPLIER_PAYMENT_REPOSITORY,
} from '../infra/tokens';
import { Gstr2bService } from './gstr2b.service';

const paise = (inr: number) => Math.round(inr * 100);
const PAGE = 200;

/** What GSTR-3B takes from the books and 2B, beyond the filed GSTR-1. */
export type Gstr3bBooks = Omit<Gstr3bInput, 'gstin' | 'month' | 'gstr1Portal' | 'adjustments'>;

/**
 * GSTR-3B's inputs for a GSTIN and month (accounts brief G6): reverse-charge self-invoices issued in the month, credit
 * from 2B's accepted lines, credit the books took back (s.17(5)(h)), and rule 37's 180-day reversals and reclaims.
 */
@Injectable()
export class Gstr3bInputs {
	constructor(
		@Inject(Gstr2bService) private readonly gstr2b: Pick<Gstr2bService, 'rows'>,
		@Inject(SELF_INVOICE_REPOSITORY) private readonly selfInvoices: Pick<SelfInvoiceRepository, 'issuedForGstin'>,
		@Inject(GENERAL_LEDGER_REPOSITORY)
		private readonly ledger: Pick<GeneralLedgerRepository, 'chart' | 'listVouchers'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: Pick<PurchaseEntryRepository, 'postedBetween'>,
		@Inject(SUPPLIER_PAYMENT_REPOSITORY) private readonly payments: Pick<SupplierPaymentRepository, 'forEntry'>,
	) {}

	async collect(gstRegistrationId: string, month: string): Promise<Gstr3bBooks> {
		const first = `${month}-01`;
		const [y, m] = month.split('-').map(Number) as [number, number];
		const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
		const locations = await this.locations.list();
		const here = new Set(locations.filter((l) => l.gstRegistrationId === gstRegistrationId).map((l) => l.id));
		const stock = locations.find((l) => l.id === defaultStockLocation(locations));
		const [invoices, twoB, reversed, rule] = await Promise.all([
			this.selfInvoices.issuedForGstin(gstRegistrationId, first, last),
			this.gstr2b.rows(gstRegistrationId, month),
			this.reversals(first, last, here),
			stock?.gstRegistrationId === gstRegistrationId ? this.rule37(month, last) : null,
		]);
		const none: TaxHeads = { igst: 0, cgst: 0, sgst: 0 };
		return {
			selfInvoices: invoices.map((s) => ({
				taxable: paise(s.taxableINR),
				igst: paise(s.igstINR),
				cgst: paise(s.cgstINR),
				sgst: paise(s.sgstINR),
			})),
			twoBImported: twoB.doc !== null,
			itc2b: claimFrom2b(twoB.rows),
			acceptedNotInBooks: twoB.rows.filter((r) => r.result === 'only_2b' && r.action === 'accept').length,
			reversedInBooks: reversed,
			rule37: rule?.reversed ?? none,
			reclaimed: rule?.reclaimed ?? none,
		};
	}

	/** 4B(1): input tax the books took back this month at the GSTIN's locations; nothing before the books are set up. */
	private async reversals(from: string, to: string, here: ReadonlySet<string>): Promise<TaxHeads> {
		const chart = await this.ledger.chart();
		let ids: Record<keyof TaxHeads, string>;
		try {
			ids = {
				igst: resolveRole(chart.ledgers, 'input_igst').id,
				cgst: resolveRole(chart.ledgers, 'input_cgst').id,
				sgst: resolveRole(chart.ledgers, 'input_sgst').id,
			};
		} catch {
			return { igst: 0, cgst: 0, sgst: 0 };
		}
		const vouchers: JournalVoucher[] = [];
		for (let page = 1; ; page += 1) {
			const found = await this.ledger.listVouchers({
				from,
				to,
				kinds: VoucherKind.options,
				search: '',
				page,
				pageSize: PAGE,
			});
			vouchers.push(...found.items);
			if (vouchers.length >= found.total || !found.items.length) break;
		}
		return reversedInBooks(vouchers, ids, here);
	}

	/** Rule 37 over bills whose 180 days have ended by the month's last day. */
	private async rule37(month: string, last: string) {
		const from = `${Number(month.slice(0, 4)) - 2}-04-01`;
		const due = (await this.entries.postedBetween(from, last)).filter(
			(e) => e.itcClaimable && e.supplierGstin && day180(e.billDate) <= last,
		);
		const bills: Rule37Bill[] = await Promise.all(
			due.map(async (e) => ({
				entryId: e.id,
				billDate: e.billDate,
				totalPaise: paise(e.totals.totalINR),
				creditedPaise: paise(e.creditedINR),
				tax: { igst: paise(e.totals.igstINR), cgst: paise(e.totals.cgstINR), sgst: paise(e.totals.sgstINR) },
				payments: (await this.payments.forEntry(e.id))
					.filter((p) => !p.reversedAt)
					.map((p) => ({ paidOn: p.paidOn, paise: paise(p.amountINR) })),
			})),
		);
		return rule37(bills, month);
	}
}
