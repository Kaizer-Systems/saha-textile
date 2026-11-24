import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	GstCalendar,
	GstCalendarQuery,
	GstCalendarRow,
	GstReturnDraft,
	GstReturnPrepare,
	GstReturnStep,
	TaxInvoice,
} from '@saha-textile/contracts';
import {
	annualReturn,
	gstr1,
	istDay,
	returnDueOn,
	termsOn,
	type CompanyRepository,
	type CreditNoteRepository,
	type DebitNoteRepository,
	type GstReturnDraftRepository,
	type GstReturnRepository,
	type TaxInvoiceRepository,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	COMPANY_REPOSITORY,
	CREDIT_NOTE_REPOSITORY,
	DEBIT_NOTE_REPOSITORY,
	GST_RETURN_DRAFT_REPOSITORY,
	GST_RETURN_REPOSITORY,
	TAX_INVOICE_REPOSITORY,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';

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
	) {}

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

	/** G4 Prepare: the return worked out from the books now; a draft not yet approved is replaced. */
	async prepare(write: GstReturnPrepare, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		if (write.returnType !== 'GSTR-1') throw refuse('gst_return_not_ready');
		const registration = await this.registration(write.gstRegistrationId);
		if (await this.filed(registration.id, write.returnType, write.month)) throw refuse('gst_return_filed');
		const existing = await this.drafts.find(registration.id, write.returnType, write.month);
		if (existing && existing.status !== 'prepared' && existing.status !== 'checked')
			throw refuse('gst_return_approved');
		const from = `${write.month}-01`;
		const to = monthEnd(write.month);
		const [invoices, creditNotes, debitNotes] = await Promise.all([
			this.invoices.listForGstin(registration.gstin, from, to),
			this.creditNotes.listForGstin(registration.gstin, from, to),
			this.debitNotes.listForGstin(registration.gstin, from, to),
		]);
		const originals = new Map<string, TaxInvoice>();
		for (const id of new Set(creditNotes.map((n) => n.invoiceId))) {
			const invoice = await this.invoices.get(id);
			if (invoice) originals.set(id, invoice);
		}
		const result = gstr1({
			gstin: registration.gstin,
			month: write.month,
			invoices,
			creditNotes,
			debitNotes,
			originals,
			hsnDigits: termsOn(registration, from)?.hsnDigits ?? 4,
		});
		const draft: GstReturnDraft = {
			id: existing?.id ?? `gsr_${randomUUID()}`,
			gstRegistrationId: registration.id,
			gstin: registration.gstin,
			returnType: write.returnType,
			month: write.month,
			status: 'prepared',
			summary: result.summary,
			problems: result.problems,
			portal: result.portal as unknown as Record<string, unknown>,
			preparedBy: principal?.userId ?? null,
			preparedAt: now.toISOString(),
			checkedBy: null,
			checkedAt: null,
			approvedBy: null,
			approvedAt: null,
			version: existing?.version ?? 0,
		};
		return this.save(draft, existing ? existing.version : null);
	}

	async get(id: string): Promise<GstReturnDraft> {
		const draft = await this.drafts.get(id);
		if (!draft) throw new NotFoundException(accountsRefusal('gst_draft_not_found'));
		return draft;
	}

	/** G4: Accountant checked (from prepared), then Approve (CA), only with `accounts.lock` and nothing to fix. */
	async step(id: string, write: GstReturnStep, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const draft = await this.get(id);
		const by = principal?.userId ?? null;
		const at = now.toISOString();
		if (write.to === 'checked') {
			if (draft.status !== 'prepared') throw refuse('gst_return_wrong_step');
			return this.save({ ...draft, status: 'checked', checkedBy: by, checkedAt: at }, write.version);
		}
		if (draft.status !== 'checked') throw refuse('gst_return_wrong_step');
		if (!principal?.permissions.includes('accounts.lock')) throw refuse('gst_return_approver_only');
		if (draft.problems.length) throw refuse('gst_return_has_problems');
		return this.save({ ...draft, status: 'approved', approvedBy: by, approvedAt: at }, write.version);
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
		const [drafts, filings] = await Promise.all([
			this.drafts.listForRegistration(registration.id),
			this.filings.list(),
		]);
		const thisMonth = istDay(now).slice(0, 7);
		const rows: GstCalendarRow[] = [];
		const years = new Set<string>();
		for (let back = CALENDAR_MONTHS; back >= 1; back--) {
			const month = addMonths(thisMonth, -back);
			const terms = termsOn(registration, `${month}-01`);
			if (!terms) continue;
			for (const returnType of ['GSTR-1', 'GSTR-3B'] as const) {
				const dueOn = returnDueOn(returnType, month, terms.scheme, registration.stateCode);
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
			if (terms.annualReturn && month.endsWith('-03')) years.add(month);
		}
		for (const month of years) {
			const annual = annualReturn(month);
			rows.push({
				returnType: 'GSTR-9',
				period: annual.period,
				dueOn: annual.dueOn,
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
