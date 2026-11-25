import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { GstRegistration, GstReturnDraft, GstReturnPrepare, GstSetOff } from '@saha-textile/contracts';
import {
	cmp08,
	financialYear,
	gstr3b,
	gstr4,
	gstr6,
	iffReturn,
	isdDistribution,
	isQuarterEnd,
	parseGstr6a,
	pmt06,
	previousQuarterEnd,
	quarterBooks,
	quarterOf,
	reportedInIff,
	termsOn,
	type CompanyRepository,
	type CompositionPurchase,
	type GstReturnDraftRepository,
	type GstReturnRepository,
	type PurchaseEntryRepository,
	type SelfInvoiceRepository,
	type TaxHeads,
	type TaxInvoiceRepository,
} from '@saha-textile/core-domain';

import {
	COMPANY_REPOSITORY,
	GST_RETURN_DRAFT_REPOSITORY,
	GST_RETURN_REPOSITORY,
	PURCHASE_ENTRY_REPOSITORY,
	SELF_INVOICE_REPOSITORY,
	TAX_INVOICE_REPOSITORY,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { Gstr3bInputs } from './gstr3b-inputs';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const paise = (inr: number) => Math.round(inr * 100);
const zero = (): TaxHeads => ({ igst: 0, cgst: 0, sgst: 0 });
const add = (a: TaxHeads, b: TaxHeads): TaxHeads => ({
	igst: a.igst + b.igst,
	cgst: a.cgst + b.cgst,
	sgst: a.sgst + b.sgst,
});
const monthEnd = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** GSTR-1 worked out between two days (the returns service's own), leaving out what an IFF already reported. */
export type Gstr1Between = (
	registration: GstRegistration,
	from: string,
	to: string,
	month: string,
	reportedInIff?: ReadonlySet<string>,
) => Promise<{ summary: GstReturnDraft['summary']; problems: GstReturnDraft['problems']; portal: unknown }>;

/** What a prepared return holds besides its status and people. */
export interface SchemeWork {
	summary: GstReturnDraft['summary'];
	problems: GstReturnDraft['problems'];
	portal: Record<string, unknown>;
	setOff: GstSetOff | null;
	inward6a: Record<string, unknown> | null;
	isdShares: GstReturnDraft['isdShares'];
}

/** A set-off with only cash to pay (PMT-06's deposit, CMP-08's tax): nothing set against credit. */
const cashOnly = (cash: TaxHeads, reverseChargeCash: TaxHeads): GstSetOff => ({
	liability: cash,
	credit: zero(),
	igstUsed: zero(),
	cgstUsed: { cgst: 0, igst: 0 },
	sgstUsed: { sgst: 0, igst: 0 },
	cash,
	carried: zero(),
	reverseChargeCash,
	deposited: null,
});

/**
 * The other kinds of taxpayer's returns (accounts brief G1–G3, G7; owner 25 Nov): QRMP's IFF, quarterly GSTR-1 and
 * GSTR-3B and PMT-06; composition's CMP-08 and GSTR-4; an ISD's GSTR-6. Each is worked out here and kept, checked,
 * approved and filed by the returns service like any other return.
 */
@Injectable()
export class GstSchemesService {
	constructor(
		@Inject(COMPANY_REPOSITORY) private readonly company: Pick<CompanyRepository, 'listRegistrations'>,
		@Inject(TAX_INVOICE_REPOSITORY) private readonly invoices: Pick<TaxInvoiceRepository, 'listForGstin'>,
		@Inject(GST_RETURN_DRAFT_REPOSITORY) private readonly drafts: Pick<GstReturnDraftRepository, 'find'>,
		@Inject(GST_RETURN_REPOSITORY) private readonly filings: Pick<GstReturnRepository, 'list'>,
		@Inject(SELF_INVOICE_REPOSITORY) private readonly selfInvoices: Pick<SelfInvoiceRepository, 'issuedForGstin'>,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: Pick<PurchaseEntryRepository, 'postedBetween'>,
		@Inject(Gstr3bInputs) private readonly inputs: Pick<Gstr3bInputs, 'collect'>,
	) {}

	private async filed(registrationId: string, returnType: string, month: string) {
		return (await this.filings.list()).some(
			(f) => f.gstRegistrationId === registrationId && f.returnType === returnType && f.month === month,
		);
	}

	/** The kind and scheme on the month's first day; refused when the return isn't this GSTIN's. */
	private terms(registration: GstRegistration, month: string) {
		const terms = termsOn(registration, `${month}-01`);
		if (!terms) throw refuse('gst_registration_not_in_force');
		return terms;
	}

	/** QRMP's quarterly GSTR-1: the quarter's documents, less what the filed IFFs of its first two months reported. */
	async quarterGstr1(registration: GstRegistration, month: string, between: Gstr1Between) {
		if (!isQuarterEnd(month)) throw refuse('gst_return_quarter_end_only');
		const quarter = quarterOf(month);
		const reported = new Set<string>();
		for (const m of quarter.months.slice(0, 2)) {
			const iff = await this.drafts.find(registration.id, 'IFF', m);
			if (iff && (await this.filed(registration.id, 'IFF', m)))
				for (const number of reportedInIff(iff.portal)) reported.add(number);
		}
		return between(registration, `${quarter.months[0]}-01`, monthEnd(month), month, reported);
	}

	/** QRMP's quarterly GSTR-3B: the quarter's books added up, set against the quarter's GSTR-1, PMT-06 used first. */
	async quarterGstr3b(registration: GstRegistration, write: GstReturnPrepare, gstr1Portal: Record<string, unknown>) {
		if (!isQuarterEnd(write.month)) throw refuse('gst_return_quarter_end_only');
		const quarter = quarterOf(write.month);
		const books = quarterBooks(
			await Promise.all(quarter.months.map((m) => this.inputs.collect(registration.id, m))),
		);
		const result = gstr3b({
			gstin: registration.gstin,
			month: write.month,
			gstr1Portal,
			...books,
			adjustments: write.adjustments,
		});
		let deposited = zero();
		for (const m of quarter.months.slice(0, 2)) {
			const paid = await this.drafts.find(registration.id, 'PMT-06', m);
			if (paid?.challanVoucherId && paid.setOff) deposited = add(deposited, paid.setOff.cash);
		}
		return { ...result, deposited };
	}

	async work(
		registration: GstRegistration,
		write: GstReturnPrepare,
		existing: GstReturnDraft | null,
		between: Gstr1Between,
	): Promise<SchemeWork> {
		const terms = this.terms(registration, write.month);
		const plain = (r: { summary: SchemeWork['summary']; problems: SchemeWork['problems']; portal: unknown }) => ({
			summary: r.summary,
			problems: r.problems,
			portal: r.portal as Record<string, unknown>,
			setOff: null,
			inward6a: null,
			isdShares: null,
		});
		switch (write.returnType) {
			case 'IFF': {
				if (terms.scheme !== 'qrmp' || isQuarterEnd(write.month)) throw refuse('gst_return_not_for_this_gstin');
				const month = await between(registration, `${write.month}-01`, monthEnd(write.month), write.month);
				return plain(
					iffReturn({
						gstin: registration.gstin,
						month: write.month,
						portal: month.portal as Record<string, unknown>,
					}),
				);
			}
			case 'PMT-06':
				if (terms.scheme !== 'qrmp' || isQuarterEnd(write.month)) throw refuse('gst_return_not_for_this_gstin');
				return this.pmt06(registration, write, between);
			case 'CMP-08':
				if (terms.kind !== 'composition') throw refuse('gst_return_not_for_this_gstin');
				return this.cmp08(registration, write.month, terms.compositionRatePercent ?? 1);
			case 'GSTR-4':
				if (terms.kind !== 'composition' || !write.month.endsWith('-03'))
					throw refuse('gst_return_not_for_this_gstin');
				return this.gstr4(registration, write.month);
			default:
				if (terms.kind !== 'isd') throw refuse('gst_return_not_for_this_gstin');
				return this.gstr6(registration, write, existing);
		}
	}

	private async pmt06(
		registration: GstRegistration,
		write: GstReturnPrepare,
		between: Gstr1Between,
	): Promise<SchemeWork> {
		let lastQuarter: { cash: TaxHeads; monthly: boolean } | null = null;
		let month3b: { cash: TaxHeads; reverseCharge: TaxHeads } | null = null;
		if (write.pmt06Method === 'fixed_sum') {
			const last = previousQuarterEnd(write.month);
			const monthly = termsOn(registration, `${last}-01`)?.scheme !== 'qrmp';
			const draft = await this.drafts.find(registration.id, 'GSTR-3B', last);
			lastQuarter = draft?.setOff
				? { cash: add(draft.setOff.cash, draft.setOff.reverseChargeCash), monthly }
				: null;
		} else {
			const month = await between(registration, `${write.month}-01`, monthEnd(write.month), write.month);
			const books = await this.inputs.collect(registration.id, write.month);
			const worked = gstr3b({
				gstin: registration.gstin,
				month: write.month,
				gstr1Portal: month.portal as Record<string, unknown>,
				...books,
				adjustments: [],
			});
			month3b = { cash: worked.setOff.cash, reverseCharge: worked.reverseChargeCash };
		}
		const result = pmt06({
			gstin: registration.gstin,
			month: write.month,
			method: write.pmt06Method,
			lastQuarter,
			month3b,
		});
		return {
			summary: result.summary,
			problems: result.problems,
			portal: result.portal,
			setOff: cashOnly(result.deposit, zero()),
			inward6a: null,
			isdShares: null,
		};
	}

	/** CMP-08: the quarter's bills of supply less their credit notes, and the reverse-charge tax on what came in. */
	private async cmp08(registration: GstRegistration, month: string, ratePercent: number): Promise<SchemeWork> {
		if (!isQuarterEnd(month)) throw refuse('gst_return_quarter_end_only');
		const quarter = quarterOf(month);
		const from = `${quarter.months[0]}-01`;
		const to = monthEnd(month);
		const [bills, rcm] = await Promise.all([
			this.invoices.listForGstin(registration.gstin, from, to),
			this.selfInvoices.issuedForGstin(registration.id, from, to),
		]);
		const live = bills.filter((b) => b.status !== 'cancelled');
		const reverseCharge = rcm.reduce(
			(s, r) => ({
				taxable: s.taxable + paise(r.taxableINR),
				records: s.records + 1,
				igst: s.igst + paise(r.igstINR),
				cgst: s.cgst + paise(r.cgstINR),
				sgst: s.sgst + paise(r.sgstINR),
			}),
			{ taxable: 0, records: 0, igst: 0, cgst: 0, sgst: 0 },
		);
		const result = cmp08({
			gstin: registration.gstin,
			quarterEnd: month,
			ratePercent,
			turnoverPaise: live.reduce((s, b) => s + paise(b.taxableINR), 0),
			bills: live.length,
			reverseCharge,
		});
		return {
			summary: result.summary,
			problems: result.problems,
			portal: result.portal,
			setOff: cashOnly(result.tax, {
				igst: reverseCharge.igst,
				cgst: reverseCharge.cgst,
				sgst: reverseCharge.sgst,
			}),
			inward6a: null,
			isdShares: null,
		};
	}

	/** GSTR-4: the year's CMP-08s as prepared, and its purchases (bills and reverse-charge self-invoices). */
	private async gstr4(registration: GstRegistration, month: string): Promise<SchemeWork> {
		const year = financialYear(month);
		const start = `${Number(year.label.slice(0, 4))}-04-01`;
		const quarters = [3, 6, 9, 12].map((back) => {
			const [y, m] = month.split('-').map(Number) as [number, number];
			return new Date(Date.UTC(y, m - 1 - (12 - back), 1)).toISOString().slice(0, 7);
		});
		const cmp = await Promise.all(quarters.map((q) => this.drafts.find(registration.id, 'CMP-08', q)));
		const [entries, rcm] = await Promise.all([
			this.entries.postedBetween(start, monthEnd(month)),
			this.selfInvoices.issuedForGstin(registration.id, start, monthEnd(month)),
		]);
		const purchases: CompositionPurchase[] = [
			...entries.map((e) => ({
				supplierGstin: e.supplierGstin,
				reverseCharge: false,
				taxable: paise(e.totals.taxableINR),
				igst: paise(e.totals.igstINR),
				cgst: paise(e.totals.cgstINR),
				sgst: paise(e.totals.sgstINR),
			})),
			...rcm.map((r) => ({
				supplierGstin: null,
				reverseCharge: true,
				taxable: paise(r.taxableINR),
				igst: paise(r.igstINR),
				cgst: paise(r.cgstINR),
				sgst: paise(r.sgstINR),
			})),
		];
		const result = gstr4({
			gstin: registration.gstin,
			year: year.label,
			cmp08s: cmp.flatMap((d) => (d ? [d.portal] : [])),
			purchases,
		});
		return { ...result, setOff: null, inward6a: null, isdShares: null };
	}

	/**
	 * GSTR-6: the 6A file (given now, or kept from the last prepare) shared among the company's other regular GSTINs in
	 * the ratio of their turnover in the last financial year, or, when one of them had none, in the last quarter.
	 */
	private async gstr6(
		registration: GstRegistration,
		write: GstReturnPrepare,
		existing: GstReturnDraft | null,
	): Promise<SchemeWork> {
		const file = write.inward6a ?? existing?.inward6a ?? null;
		if (!file) throw refuse('gstr6a_needed');
		let parsed: ReturnType<typeof parseGstr6a>;
		try {
			parsed = parseGstr6a(file);
		} catch (error) {
			throw refuse((error as Error).message);
		}
		if (parsed.gstin !== registration.gstin) throw refuse('gstr6a_other_gstin');
		if (parsed.month !== write.month) throw refuse('gstr6a_other_month');
		const day = `${write.month}-01`;
		const others = (await this.company.listRegistrations()).filter((r) => {
			const kind = termsOn(r, day)?.kind;
			return r.id !== registration.id && (kind === 'regular' || kind === 'casual');
		});
		const turnover = async (from: string, to: string) =>
			Promise.all(
				others.map(async (r) =>
					(await this.invoices.listForGstin(r.gstin, from, to))
						.filter((i) => i.status !== 'cancelled')
						.reduce((s, i) => s + paise(i.taxableINR), 0),
				),
			);
		const yearStart = Number(financialYear(write.month).label.slice(0, 4));
		let weights = await turnover(`${yearStart - 1}-04-01`, `${yearStart}-03-31`);
		if (weights.some((w) => w <= 0)) {
			const last = previousQuarterEnd(write.month);
			weights = await turnover(`${quarterOf(last).months[0]}-01`, monthEnd(last));
		}
		const distribution = isdDistribution({
			isdGstin: registration.gstin,
			isdState: registration.stateCode,
			month: write.month,
			lines: parsed.lines,
			recipients: others.map((r, i) => ({
				registrationId: r.id,
				gstin: r.gstin,
				stateCode: r.stateCode,
				turnoverPaise: weights[i] as number,
			})),
		});
		const result = gstr6({
			isdGstin: registration.gstin,
			month: write.month,
			day: monthEnd(write.month),
			lines: parsed.lines,
			distribution,
		});
		return { ...result, setOff: null, inward6a: { ...file }, isdShares: distribution.shares };
	}
}
