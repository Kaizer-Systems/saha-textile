import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { GstDistributionPost, GstReturnDraft, GstSetOffPost } from '@saha-textile/contracts';
import {
	defaultStockLocation,
	quarterOf,
	setOffPostings,
	type GstPostingRow,
	type BankRepository,
	type GstReturnDraftRepository,
	type LocationRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	BANK_REPOSITORY,
	GST_RETURN_DRAFT_REPOSITORY,
	LOCATION_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerService } from '../ledger/ledger.service';
import { GstReturnsService } from './gst-returns.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));

/** The last day of a `YYYY-MM` month. */
const monthEnd = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * Q7 Post the set-off (accounts brief): once the CA has approved a GSTR-3B, the set-off is posted as a journal (output
 * tax against the credit used) and the challan's payment from a bank account (the cash and the reverse-charge tax), in
 * one transaction, each once. The draft keeps both vouchers and the challan.
 */
@Injectable()
export class GstSetOffService {
	constructor(
		@Inject(GstReturnsService) private readonly returns: Pick<GstReturnsService, 'get'>,
		@Inject(GST_RETURN_DRAFT_REPOSITORY) private readonly drafts: Pick<GstReturnDraftRepository, 'save'>,
		@Inject(BANK_REPOSITORY) private readonly banks: Pick<BankRepository, 'get'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
		@Inject(LedgerService) private readonly ledger: Pick<LedgerService, 'post' | 'ensureRoleLedger'>,
	) {}

	/** The ledgers the other taxpayers' payments post to, made in the books the first time they are needed. */
	private async ledgerFor(
		role: 'gst_cash_ledger' | 'composition_tax' | 'composition_tax_payable',
		by: string | null,
	) {
		const made = {
			gst_cash_ledger: ['GST electronic cash ledger', 'loans_and_advances'],
			composition_tax: ['Composition tax', 'indirect_expenses'],
			composition_tax_payable: ['Composition tax payable', 'duties_and_taxes'],
		}[role];
		return this.ledger.ensureRoleLedger(role, made[0] as string, made[1] as string, by);
	}

	/** The GSTIN's location the postings stand at: the stock location when it is this GSTIN's, else its first one. */
	private async locationOf(gstRegistrationId: string): Promise<string> {
		const all = await this.locations.list();
		const stock = all.find((l) => l.id === defaultStockLocation(all));
		const here =
			stock?.gstRegistrationId === gstRegistrationId
				? stock
				: all.find((l) => l.active && l.gstRegistrationId === gstRegistrationId);
		if (!here) throw refuse('books_need_a_location');
		return here.id;
	}

	/**
	 * What a payable return posts: GSTR-3B its set-off (PMT-06 deposits used first) and challan; PMT-06 the deposit
	 * into the GST cash ledger; CMP-08 the quarter's composition tax as an expense (dated the quarter's last day) and
	 * its payment with any reverse-charge tax.
	 */
	private async postings(
		draft: GstReturnDraft & { setOff: NonNullable<GstReturnDraft['setOff']> },
		by: string | null,
	) {
		const s = draft.setOff;
		const total = s.cash.igst + s.cash.cgst + s.cash.sgst;
		if (draft.returnType === 'PMT-06') {
			const cashLedger = await this.ledgerFor('gst_cash_ledger', by);
			return {
				expense: [] as GstPostingRow[],
				journal: [] as GstPostingRow[],
				challan: total ? [{ role: 'gst_cash_ledger', debitPaise: total }] : [],
				cashPaise: total,
				ids: { gst_cash_ledger: cashLedger } as Record<string, string>,
			};
		}
		if (draft.returnType === 'CMP-08') {
			const rcm = s.reverseChargeCash.igst + s.reverseChargeCash.cgst + s.reverseChargeCash.sgst;
			const tax = total - rcm;
			const ids = {
				composition_tax: await this.ledgerFor('composition_tax', by),
				composition_tax_payable: await this.ledgerFor('composition_tax_payable', by),
			};
			const expense = tax
				? [
						{ role: 'composition_tax', debitPaise: tax },
						{ role: 'composition_tax_payable', creditPaise: tax },
					]
				: [];
			const challan = [
				...(tax ? [{ role: 'composition_tax_payable', debitPaise: tax }] : []),
				...(rcm ? [{ role: 'rcm_payable', debitPaise: rcm }] : []),
			];
			return {
				expense,
				journal: [] as GstPostingRow[],
				challan,
				cashPaise: total,
				ids: ids as Record<string, string>,
			};
		}
		const posted = setOffPostings(s, s.reverseChargeCash, s.deposited ?? null);
		const ids: Record<string, string> = {};
		if (posted.journal.some((row) => row.role === 'gst_cash_ledger'))
			ids['gst_cash_ledger'] = await this.ledgerFor('gst_cash_ledger', by);
		return { expense: [] as GstPostingRow[], ...posted, ids };
	}

	async post(
		id: string,
		write: GstSetOffPost,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<GstReturnDraft> {
		const draft = await this.returns.get(id);
		const payable = ['GSTR-3B', 'PMT-06', 'CMP-08'];
		if (!payable.includes(draft.returnType) || !draft.setOff) throw refuse('gst_set_off_not_3b');
		if (draft.status !== 'approved' && draft.status !== 'filed') throw refuse('gst_set_off_not_approved');
		if (draft.setOffVoucherId || draft.challanVoucherId) throw refuse('gst_set_off_posted');
		if (draft.version !== write.version) throw new ConflictException(accountsRefusal('gst_draft_changed'));
		const bank = await this.banks.get(write.bankAccountId);
		if (!bank) throw new NotFoundException(accountsRefusal('bank_account_unknown'));
		const by = principal?.userId ?? null;
		const { expense, journal, challan, cashPaise, ids } = await this.postings(
			{ ...draft, setOff: draft.setOff },
			by,
		);
		if (!journal.length && !cashPaise) throw refuse('gst_set_off_nothing');
		const locationId = await this.locationOf(draft.gstRegistrationId);
		const what = `${draft.returnType} ${draft.month} · ${draft.gstin}`;
		const lines = (rows: readonly GstPostingRow[]) =>
			rows.map(({ role, ...amounts }) => ({
				ledger: ids[role] ? { id: ids[role] as string } : { role },
				locationId,
				...amounts,
			}));
		const posted = await this.transactions.withTransaction(async (context) => {
			const booked = expense.length
				? await this.ledger.post(
						{
							kind: 'journal',
							date: monthEnd(quarterOf(draft.month).last),
							narration: `Composition tax on the quarter's turnover, ${what}`,
							source: { type: 'compositionTax', id: draft.id, number: null },
							idempotencyKey: `compositionTax:${draft.id}`,
							lines: lines(expense),
						},
						context,
						by,
					)
				: null;
			const setOff = journal.length
				? await this.ledger.post(
						{
							kind: 'journal',
							date: write.paidOn,
							narration: `GST set-off, ${what} (s.49, rule 88A)`,
							source: { type: 'gstSetOff', id: draft.id, number: null },
							idempotencyKey: `gstSetOff:${draft.id}`,
							lines: lines(journal),
						},
						context,
						by,
					)
				: null;
			const paid = cashPaise
				? await this.ledger.post(
						{
							kind: 'payment',
							date: write.paidOn,
							narration: `GST challan ${write.challan} (PMT-06), ${what}`,
							source: { type: 'gstChallan', id: draft.id, number: write.challan },
							idempotencyKey: `gstChallan:${draft.id}`,
							lines: [
								...lines(challan),
								{ ledger: { id: bank.ledgerId }, locationId, creditPaise: cashPaise },
							],
						},
						context,
						by,
					)
				: null;
			return { setOff, paid, booked };
		});
		try {
			return await this.drafts.save(
				{
					...draft,
					// The draft is stored as approved; filed is read from the filing.
					status: draft.status === 'filed' ? 'approved' : draft.status,
					arn: null,
					filedOn: null,
					setOffVoucherId: posted.setOff?.id ?? null,
					challanVoucherId: posted.paid?.id ?? null,
					expenseVoucherId: posted.booked?.id ?? null,
					challan: {
						number: write.challan,
						paidOn: write.paidOn,
						bankAccountId: bank.id,
						amountPaise: cashPaise,
						setOffNumber: posted.setOff?.number ?? null,
						challanNumber: posted.paid?.number ?? null,
					},
				},
				write.version,
			);
		} catch (error) {
			if (error instanceof Error && error.message === 'gst_draft_changed')
				throw new ConflictException(accountsRefusal('gst_draft_changed'));
			throw error;
		}
	}
	/**
	 * GSTR-6 Post the distribution: one journal moving the approved credit from the ISD's input tax to each recipient
	 * GSTIN's (IGST to another State), dated the month's last day, once. The recipients' GSTR-3B take it in 4A(4).
	 */
	async distribute(
		id: string,
		write: GstDistributionPost,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<GstReturnDraft> {
		const draft = await this.returns.get(id);
		if (draft.returnType !== 'GSTR-6' || !draft.isdShares?.length) throw refuse('gst_distribution_not_isd');
		if (draft.status !== 'approved' && draft.status !== 'filed') throw refuse('gst_set_off_not_approved');
		if (draft.distributionVoucherId) throw refuse('gst_set_off_posted');
		if (draft.version !== write.version) throw new ConflictException(accountsRefusal('gst_draft_changed'));
		const by = principal?.userId ?? null;
		const isd = await this.locationOf(draft.gstRegistrationId);
		const heads = [
			['igst', 'input_igst'],
			['cgst', 'input_cgst'],
			['sgst', 'input_sgst'],
		] as const;
		const lines: { ledger: { role: string }; locationId: string; debitPaise?: number; creditPaise?: number }[] = [];
		for (const share of draft.isdShares) {
			const at = await this.locationOf(share.registrationId);
			for (const [head, role] of heads) {
				if (share.credit[head])
					lines.push({ ledger: { role }, locationId: at, debitPaise: share.credit[head] });
				if (share.from[head]) lines.push({ ledger: { role }, locationId: isd, creditPaise: share.from[head] });
			}
		}
		if (!lines.length) throw refuse('gst_set_off_nothing');
		const voucher = await this.transactions.withTransaction((context) =>
			this.ledger.post(
				{
					kind: 'journal',
					date: monthEnd(draft.month),
					narration: `ISD distribution, GSTR-6 ${draft.month} · ${draft.gstin} (rule 39)`,
					source: { type: 'isdDistribution', id: draft.id, number: null },
					idempotencyKey: `isdDistribution:${draft.id}`,
					lines,
				},
				context,
				by,
			),
		);
		try {
			return await this.drafts.save(
				{
					...draft,
					status: draft.status === 'filed' ? 'approved' : draft.status,
					arn: null,
					filedOn: null,
					distributionVoucherId: voucher.id,
				},
				write.version,
			);
		} catch (error) {
			if (error instanceof Error && error.message === 'gst_draft_changed')
				throw new ConflictException(accountsRefusal('gst_draft_changed'));
			throw error;
		}
	}
}
