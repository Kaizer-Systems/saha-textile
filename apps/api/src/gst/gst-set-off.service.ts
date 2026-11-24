import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { GstReturnDraft, GstSetOffPost } from '@saha-textile/contracts';
import {
	defaultStockLocation,
	setOffPostings,
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
		@Inject(LedgerService) private readonly ledger: Pick<LedgerService, 'post'>,
	) {}

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

	async post(
		id: string,
		write: GstSetOffPost,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<GstReturnDraft> {
		const draft = await this.returns.get(id);
		if (draft.returnType !== 'GSTR-3B' || !draft.setOff) throw refuse('gst_set_off_not_3b');
		if (draft.status !== 'approved' && draft.status !== 'filed') throw refuse('gst_set_off_not_approved');
		if (draft.setOffVoucherId || draft.challanVoucherId) throw refuse('gst_set_off_posted');
		if (draft.version !== write.version) throw new ConflictException(accountsRefusal('gst_draft_changed'));
		const bank = await this.banks.get(write.bankAccountId);
		if (!bank) throw new NotFoundException(accountsRefusal('bank_account_unknown'));
		const { journal, challan, cashPaise } = setOffPostings(draft.setOff, draft.setOff.reverseChargeCash);
		if (!journal.length && !cashPaise) throw refuse('gst_set_off_nothing');
		const locationId = await this.locationOf(draft.gstRegistrationId);
		const by = principal?.userId ?? null;
		const what = `${draft.returnType} ${draft.month} · ${draft.gstin}`;
		const lines = (rows: typeof journal) =>
			rows.map(({ role, ...amounts }) => ({ ledger: { role }, locationId, ...amounts }));
		const posted = await this.transactions.withTransaction(async (context) => {
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
			return { setOff, paid };
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
}
