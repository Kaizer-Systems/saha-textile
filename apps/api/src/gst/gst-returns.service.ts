import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	GstRegistration,
	GstCalendar,
	GstCalendarQuery,
	GstCalendarRow,
	GstReturnDraft,
	GstReturnPrepare,
	GstReturnStep,
	TaxInvoice,
} from '@saha-textile/contracts';
import {
	dueFromRules,
	financialYear,
	returnsFor,
	gstr1,
	gstr3b,
	istDay,
	termsOn,
	type AdminUserRepository,
	type CompanyRepository,
	type CreditNoteRepository,
	type DebitNoteRepository,
	type GstReturnDraftRepository,
	type GstReturnRepository,
	type TaxInvoiceRepository,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADMIN_USER_REPOSITORY,
	COMPANY_REPOSITORY,
	CREDIT_NOTE_REPOSITORY,
	DEBIT_NOTE_REPOSITORY,
	GST_RETURN_DRAFT_REPOSITORY,
	GST_RETURN_REPOSITORY,
	TAX_INVOICE_REPOSITORY,
} from '../infra/tokens';
import { AccountsTemplatesService } from '../accounts-templates/accounts-templates.service';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { GstSchemesService, type SchemeWork } from './gst-schemes.service';
import { Gstr3bInputs } from './gstr3b-inputs';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));

/** The last day of a `YYYY-MM` month. */
const monthEnd = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const addMonths = (month: string, n: number) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	const at = new Date(Date.UTC(y, m - 1 + n, 1));
	return at.toISOString().slice(0, 7);
};
/** How many months back the calendar lists. */
const CALENDAR_MONTHS = 12;

/**
 * GST returns from the books (accounts brief G3, G4). GSTR-1 is prepared from a GSTIN's invoices and notes of the month
 * (core `gstr1`), checked by the accountant (`accounts.post`), approved by the CA or the owner (`accounts.lock`) when it
 * has no problems, and filed on the portal; entering the ARN (`markFiled`) makes it filed and locks the month's sales.
 * It can be prepared again until approved.
 */
@Injectable()
export class GstReturnsService {
	constructor(
		@Inject(GST_RETURN_DRAFT_REPOSITORY) private readonly drafts: GstReturnDraftRepository,
		@Inject(GST_RETURN_REPOSITORY) private readonly filings: Pick<GstReturnRepository, 'list'>,
		@Inject(COMPANY_REPOSITORY) private readonly company: Pick<CompanyRepository, 'getRegistration'>,
		@Inject(TAX_INVOICE_REPOSITORY) private readonly invoices: Pick<TaxInvoiceRepository, 'listForGstin' | 'get'>,
		@Inject(CREDIT_NOTE_REPOSITORY) private readonly creditNotes: Pick<CreditNoteRepository, 'listForGstin'>,
		@Inject(DEBIT_NOTE_REPOSITORY) private readonly debitNotes: Pick<DebitNoteRepository, 'listForGstin'>,
		/** Due dates come from the installed due-date rule set (RS-DUE), which the CA keeps current. */
		@Inject(AccountsTemplatesService) private readonly templates: Pick<AccountsTemplatesService, 'ruleSetEntries'>,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
		/** GSTR-3B's figures from the books and 2B. */
		@Inject(Gstr3bInputs) private readonly inputs: Pick<Gstr3bInputs, 'collect'>,
		/** QRMP, composition and ISD returns (G1–G3, G7). */
		@Inject(GstSchemesService)
		private readonly schemes: Pick<GstSchemesService, 'work' | 'quarterGstr1' | 'quarterGstr3b'>,
	) {}

	/** Who took a step, by name; the user id when the account has no name, '' with no one signed in. */
	private async nameOf(principal: AuthenticatedPrincipal | undefined): Promise<string> {
		if (!principal) return '';
		const user = await this.admins.findById(principal.userId).catch(() => null);
		return user?.displayName || user?.email || user?.username || principal.userId;
	}

	private async registration(id: string) {
		const registration = await this.company.getRegistration(id);
		if (!registration) throw new NotFoundException(accountsRefusal('gst_registration_unknown'));
		return registration;
	}

	private async filed(gstRegistrationId: string, returnType: string, month: string) {
		return (await this.filings.list()).find(
			(f) => f.gstRegistrationId === gstRegistrationId && f.returnType === returnType && f.month === month,
		);
	}

	/**
	 * GSTR-1 worked out from the GSTIN's invoices and notes of the month (core `gstr1`); under QRMP, of the quarter that
	 * ends with the month, less what its IFFs reported.
	 */
	private gstr1For(registration: GstRegistration, month: string) {
		if (termsOn(registration, `${month}-01`)?.scheme === 'qrmp')
			return this.schemes.quarterGstr1(registration, month, this.between);
		return this.gstr1Between(registration, `${month}-01`, monthEnd(month), month);
	}

	private readonly between = (
		registration: GstRegistration,
		from: string,
		to: string,
		month: string,
		reportedInIff?: ReadonlySet<string>,
	) => this.gstr1Between(registration, from, to, month, reportedInIff);

	/** GSTR-1's tables worked out from the books between two days (GSTR-9 takes a whole year). */
	async gstr1Between(
		registration: GstRegistration,
		from: string,
		to: string,
		month: string,
		reportedInIff?: ReadonlySet<string>,
	) {
		const [invoices, creditNotes, debitNotes] = await Promise.all([
			this.invoices.listForGstin(registration.gstin, from, to),
			this.creditNotes.listForGstin(registration.gstin, from, to),
			this.debitNotes.listForGstin(registration.gstin, from, to),
		]);
		const originals = new Map<string, TaxInvoice>();
		for (const id of new Set([...creditNotes, ...debitNotes].map((n) => n.invoiceId))) {
			const invoice = await this.invoices.get(id);
			if (invoice) originals.set(id, invoice);
		}
		return gstr1({
			gstin: registration.gstin,
			month,
			invoices,
			creditNotes,
			debitNotes,
			originals,
			hsnDigits: termsOn(registration, from)?.hsnDigits ?? 4,
			reportedInIff,
		});
	}

	/**
	 * G6: GSTR-3B from the filed GSTR-1 (as prepared here, else worked out again from the books), the month's
	 * self-invoices, 2B's accepted credit, the books' reversals and rule 37, with the accountant's changes. GSTR-1 must
	 * be filed first, since its values feed 3B. Under QRMP, for the quarter, with its PMT-06 deposits used first.
	 */
	private async gstr3bFor(registration: GstRegistration, write: GstReturnPrepare) {
		if (!(await this.filed(registration.id, 'GSTR-1', write.month))) throw refuse('gst_gstr1_not_filed');
		const gstr1Draft = await this.drafts.find(registration.id, 'GSTR-1', write.month);
		const gstr1Portal = (gstr1Draft?.portal ?? (await this.gstr1For(registration, write.month)).portal) as Record<
			string,
			unknown
		>;
		if (termsOn(registration, `${write.month}-01`)?.scheme === 'qrmp')
			return this.schemes.quarterGstr3b(registration, write, gstr1Portal);
		const books = await this.inputs.collect(registration.id, write.month);
		return {
			...gstr3b({
				gstin: registration.gstin,
				month: write.month,
				gstr1Portal,
				...books,
				adjustments: write.adjustments,
			}),
			deposited: null,
		};
	}

	/** What a return holds once worked out: GSTR-1, GSTR-3B, or one of the other taxpayers' returns. */
	private async work(
		registration: GstRegistration,
		write: GstReturnPrepare,
		existing: GstReturnDraft | null,
	): Promise<SchemeWork> {
		if (write.returnType === 'GSTR-3B') {
			const r = await this.gstr3bFor(registration, write);
			return {
				summary: r.summary,
				problems: r.problems,
				portal: r.portal,
				setOff: { ...r.setOff, reverseChargeCash: r.reverseChargeCash, deposited: r.deposited },
				inward6a: null,
				isdShares: null,
			};
		}
		if (write.returnType === 'GSTR-1') {
			const r = await this.gstr1For(registration, write.month);
			return {
				summary: r.summary,
				problems: r.problems,
				portal: r.portal as unknown as Record<string, unknown>,
				setOff: null,
				inward6a: null,
				isdShares: null,
			};
		}
		return this.schemes.work(registration, write, existing, this.between);
	}

	/** G4, G6 Prepare: the return worked out from the books now; a draft not yet approved is replaced. */
	async prepare(write: GstReturnPrepare, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const registration = await this.registration(write.gstRegistrationId);
		if (await this.filed(registration.id, write.returnType, write.month)) throw refuse('gst_return_filed');
		const existing = await this.drafts.find(registration.id, write.returnType, write.month);
		if (existing && existing.status !== 'prepared' && existing.status !== 'checked')
			throw refuse('gst_return_approved');
		const result = await this.work(registration, write, existing);
		const draft: GstReturnDraft = {
			id: existing?.id ?? `gsr_${randomUUID()}`,
			gstRegistrationId: registration.id,
			gstin: registration.gstin,
			returnType: write.returnType,
			month: write.month,
			status: 'prepared',
			summary: result.summary,
			problems: result.problems,
			portal: result.portal,
			preparedBy: principal?.userId ?? null,
			preparedAt: now.toISOString(),
			checkedBy: null,
			checkedAt: null,
			approvedBy: null,
			approvedAt: null,
			preparedByName: await this.nameOf(principal),
			checkedByName: '',
			approvedByName: '',
			arn: null,
			filedOn: null,
			setOff: result.setOff,
			adjustments: write.returnType === 'GSTR-3B' ? write.adjustments : [],
			setOffVoucherId: null,
			challanVoucherId: null,
			inward6a: result.inward6a,
			isdShares: result.isdShares,
			version: existing?.version ?? 0,
		};
		return this.save(draft, existing ? existing.version : null);
	}

	/** A draft as it stands: once its ARN is entered it reads filed, with the ARN and day. */
	async get(id: string): Promise<GstReturnDraft> {
		const draft = await this.drafts.get(id);
		if (!draft) throw new NotFoundException(accountsRefusal('gst_draft_not_found'));
		const filing = await this.filed(draft.gstRegistrationId, draft.returnType, draft.month);
		return filing ? { ...draft, status: 'filed', arn: filing.arn, filedOn: filing.filedOn } : draft;
	}

	/** G4: Accountant checked (from prepared), then Approve (CA), only with `accounts.lock` and nothing to fix. */
	async step(id: string, write: GstReturnStep, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const draft = await this.get(id);
		const by = principal?.userId ?? null;
		const at = now.toISOString();
		if (write.to === 'checked') {
			if (draft.status !== 'prepared') throw refuse('gst_return_wrong_step');
			return this.save(
				{
					...draft,
					status: 'checked',
					checkedBy: by,
					checkedAt: at,
					checkedByName: await this.nameOf(principal),
				},
				write.version,
			);
		}
		if (draft.status !== 'checked') throw refuse('gst_return_wrong_step');
		if (!principal?.permissions.includes('accounts.lock')) throw refuse('gst_return_approver_only');
		if (draft.problems.length) throw refuse('gst_return_has_problems');
		return this.save(
			{
				...draft,
				status: 'approved',
				approvedBy: by,
				approvedAt: at,
				approvedByName: await this.nameOf(principal),
			},
			write.version,
		);
	}

	private async save(draft: GstReturnDraft, expectedVersion: number | null) {
		try {
			return await this.drafts.save(draft, expectedVersion);
		} catch (error) {
			if (error instanceof Error && error.message === 'gst_draft_changed')
				throw new ConflictException(accountsRefusal('gst_draft_changed'));
			throw error;
		}
	}

	/** G3: each month's returns and each year's annual return, with their due dates and where they stand. */
	async calendar(query: GstCalendarQuery, now = new Date()): Promise<GstCalendar> {
		const registration = await this.registration(query.gstRegistrationId);
		const today = istDay(now);
		const [drafts, filings, rules] = await Promise.all([
			this.drafts.listForRegistration(registration.id),
			this.filings.list(),
			this.templates.ruleSetEntries('RS-DUE', today),
		]);
		if (!rules.length) throw refuse('gst_due_dates_not_installed');
		const thisMonth = today.slice(0, 7);
		const rows: GstCalendarRow[] = [];
		const years = new Set<string>();
		for (let back = CALENDAR_MONTHS; back >= 1; back--) {
			const month = addMonths(thisMonth, -back);
			const terms = termsOn(registration, `${month}-01`);
			if (!terms) continue;
			for (const returnType of returnsFor(terms.kind, terms.scheme)) {
				const dueOn = dueFromRules(rules, returnType, month, terms.scheme, registration.stateCode);
				if (!dueOn) continue;
				const filing = filings.find(
					(f) => f.gstRegistrationId === registration.id && f.returnType === returnType && f.month === month,
				);
				const draft = drafts.find((d) => d.returnType === returnType && d.month === month);
				rows.push({
					returnType,
					period: month,
					dueOn,
					status: filing ? 'filed' : (draft?.status ?? 'not_started'),
					arn: filing?.arn ?? null,
					draftId: draft?.id ?? null,
				});
			}
			if (terms.annualReturn && terms.kind !== 'composition' && month.endsWith('-03')) years.add(month);
			// G2: a composition GSTIN's yearly GSTR-4, prepared for the year's last month.
			if (terms.kind === 'composition' && month.endsWith('-03')) {
				const dueOn = dueFromRules(rules, 'GSTR-4', month, terms.scheme, registration.stateCode);
				const filing = filings.find(
					(f) => f.gstRegistrationId === registration.id && f.returnType === 'GSTR-4' && f.month === month,
				);
				const draft = drafts.find((d) => d.returnType === 'GSTR-4' && d.month === month);
				if (dueOn)
					rows.push({
						returnType: 'GSTR-4',
						period: month,
						dueOn,
						status: filing ? 'filed' : (draft?.status ?? 'not_started'),
						arn: filing?.arn ?? null,
						draftId: draft?.id ?? null,
					});
			}
		}
		for (const month of years) {
			const year = financialYear(month);
			const dueOn = dueFromRules(rules, 'GSTR-9', year.lastMonth, 'monthly', registration.stateCode);
			if (!dueOn) continue;
			rows.push({
				returnType: 'GSTR-9',
				period: year.label,
				dueOn,
				status: 'not_started',
				arn: null,
				draftId: null,
			});
		}
		rows.sort((a, b) => b.dueOn.localeCompare(a.dueOn) || a.returnType.localeCompare(b.returnType));
		const filedRows = rows.filter((r) => r.status === 'filed');
		const dueRows = rows.filter((r) => r.status !== 'filed');
		return {
			gstin: registration.gstin,
			rows: query.chip === 'all' ? rows : query.chip === 'filed' ? filedRows : dueRows,
			counts: { due: dueRows.length, filed: filedRows.length, all: rows.length },
		};
	}
}
