import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { GstAnnual, GstAnnualNoteWrite, GstAnnualQuery, GstReturnDraft } from '@saha-textile/contracts';
import {
	GSTR1_EXPORT_TABLES,
	GSTR1_SUPPLY_TABLES,
	annualRows,
	defaultStockLocation,
	fyMonths,
	tablesTotal,
	type CompanyRepository,
	type GstAnnualNoteRepository,
	type GstReturnDraftRepository,
	type GstReturnRepository,
	type LocationRepository,
	type PurchaseEntryRepository,
	type SelfInvoiceRepository,
} from '@saha-textile/core-domain';

import {
	COMPANY_REPOSITORY,
	GST_ANNUAL_NOTE_REPOSITORY,
	GST_RETURN_DRAFT_REPOSITORY,
	GST_RETURN_REPOSITORY,
	LOCATION_REPOSITORY,
	PURCHASE_ENTRY_REPOSITORY,
	SELF_INVOICE_REPOSITORY,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { GstReturnsService } from './gst-returns.service';
import { Gstr3bInputs } from './gstr3b-inputs';

const paise = (inr: number) => Math.round(inr * 100);
const monthEnd = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const heads = (t: { igst: number; cgst: number; sgst: number }) => t.igst + t.cgst + t.sgst;

/**
 * GSTR-9 against the books (accounts brief G9) and each month's returns against the books (G7 "Books to returns"):
 * the year's filed GSTR-1 and GSTR-3B beside the same figures worked out from the books, with the accountant's note on
 * each difference.
 */
@Injectable()
export class GstAnnualService {
	constructor(
		@Inject(GstReturnsService) private readonly returns: Pick<GstReturnsService, 'gstr1Between'>,
		@Inject(Gstr3bInputs) private readonly inputs: Pick<Gstr3bInputs, 'reversedFor'>,
		@Inject(COMPANY_REPOSITORY) private readonly company: Pick<CompanyRepository, 'getRegistration'>,
		@Inject(GST_RETURN_DRAFT_REPOSITORY)
		private readonly drafts: Pick<GstReturnDraftRepository, 'listForRegistration'>,
		@Inject(GST_RETURN_REPOSITORY) private readonly filings: Pick<GstReturnRepository, 'list'>,
		@Inject(GST_ANNUAL_NOTE_REPOSITORY) private readonly notes: GstAnnualNoteRepository,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: Pick<PurchaseEntryRepository, 'postedBetween'>,
		@Inject(SELF_INVOICE_REPOSITORY) private readonly selfInvoices: Pick<SelfInvoiceRepository, 'issuedForGstin'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
	) {}

	/** Input credit the books took, by month: purchase bills with credit (at the stock location's GSTIN) and reverse charge. */
	private async creditByMonth(gstRegistrationId: string, from: string, to: string): Promise<Map<string, number>> {
		const all = await this.locations.list();
		const stock = all.find((l) => l.id === defaultStockLocation(all));
		const byMonth = new Map<string, number>();
		const add = (day: string, amount: number) =>
			byMonth.set(day.slice(0, 7), (byMonth.get(day.slice(0, 7)) ?? 0) + amount);
		if (stock?.gstRegistrationId === gstRegistrationId)
			for (const e of await this.entries.postedBetween(from, to))
				if (e.itcClaimable) add(e.billDate, paise(e.totals.igstINR + e.totals.cgstINR + e.totals.sgstINR));
		for (const s of await this.selfInvoices.issuedForGstin(gstRegistrationId, from, to))
			if (s.date) add(s.date, paise(s.taxINR));
		return byMonth;
	}

	async view(query: GstAnnualQuery): Promise<GstAnnual> {
		const registration = await this.company.getRegistration(query.gstRegistrationId);
		if (!registration) throw new NotFoundException(accountsRefusal('gst_registration_unknown'));
		const months = fyMonths(query.year);
		const from = `${months[0]}-01`;
		const to = monthEnd(months[11] as string);
		const [drafts, filings, saved, credit, reversed, booksYear] = await Promise.all([
			this.drafts.listForRegistration(registration.id),
			this.filings.list(),
			this.notes.get(registration.id, query.year),
			this.creditByMonth(registration.id, from, to),
			this.inputs.reversedFor(registration.id, from, to),
			this.returns.gstr1Between(registration, from, to, months[11] as string),
		]);
		const filed = (draft: GstReturnDraft) =>
			filings.some(
				(f) =>
					f.gstRegistrationId === registration.id &&
					f.returnType === draft.returnType &&
					f.month === draft.month,
			);
		const ofYear = drafts.filter((d) => months.includes(d.month) && filed(d));
		const gstr1 = ofYear.filter((d) => d.returnType === 'GSTR-1');
		const gstr3b = ofYear.filter((d) => d.returnType === 'GSTR-3B');
		const rows = annualRows({
			gstr1,
			gstr3b,
			books: {
				summary: booksYear.summary,
				portal: booksYear.portal as unknown as Record<string, unknown>,
				inputCredit: [...credit.values()].reduce((sum, v) => sum + v, 0),
				reversed: heads(reversed),
			},
		});
		const supplyTables = [...GSTR1_SUPPLY_TABLES, ...GSTR1_EXPORT_TABLES];
		const monthChecks = await Promise.all(
			months.map(async (month) => {
				const one = gstr1.find((d) => d.month === month);
				const three = gstr3b.find((d) => d.month === month);
				const books = await this.returns.gstr1Between(registration, `${month}-01`, monthEnd(month), month);
				return {
					month,
					gstr1Tax: one ? tablesTotal(one.summary, supplyTables).tax : null,
					gstr3bTax: three ? tablesTotal(three.summary, ['3.1a', '3.1b']).tax : null,
					booksTax: tablesTotal(books.summary, supplyTables).tax,
					gstr3bCredit: three ? tablesTotal(three.summary, ['4A']).tax : null,
					booksCredit: credit.get(month) ?? 0,
				};
			}),
		);
		return {
			gstin: registration.gstin,
			year: query.year,
			rows: rows.map((row) => ({ ...row, note: saved?.notes[row.table] ?? '' })),
			months: monthChecks,
			version: saved?.version ?? 0,
		};
	}

	/** G9 "Explained": why a table differs from the books. */
	async note(write: GstAnnualNoteWrite): Promise<GstAnnual> {
		const saved = await this.notes.get(write.gstRegistrationId, write.year);
		if ((saved?.version ?? 0) !== write.version) throw new ConflictException(accountsRefusal('gst_annual_changed'));
		try {
			await this.notes.save(
				write.gstRegistrationId,
				write.year,
				{ ...(saved?.notes ?? {}), [write.table]: write.note },
				saved ? saved.version : null,
			);
		} catch (error) {
			if (error instanceof Error && error.message === 'gst_annual_changed')
				throw new ConflictException(accountsRefusal('gst_annual_changed'));
			throw error;
		}
		return this.view({ gstRegistrationId: write.gstRegistrationId, year: write.year });
	}
}
