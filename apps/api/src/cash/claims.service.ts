import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import type {
	ClaimDecisionWrite,
	ClaimList,
	ClaimListQuery,
	ExpenseClaim,
	ExpenseClaimWrite,
} from '@saha-textile/contracts';
import {
	claimApprovalPosting,
	claimPaymentPosting,
	istDay,
	type CashRepository,
	type LocationRepository,
	type MediaAssetRepository,
	type TransactionContext,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { CASH_REPOSITORY, LOCATION_REPOSITORY, MEDIA_ASSET_REPOSITORY, TRANSACTION_MANAGER } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { EditLogService } from '../ledger/edit-log';
import { LedgerService } from '../ledger/ledger.service';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';
import { isBank, ledgersUnder } from './cash-books';
import { CashService, type CashAccess } from './cash.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));

/**
 * Staff expense claims (accounts brief O12): a staff member's own-pocket spend with its bill, approved by a manager
 * and paid back from petty cash, by bank, or with their next salary. Approval posts the expense against what is owed
 * to them; paying back posts that away.
 */
@Injectable()
export class ClaimsService {
	constructor(
		@Inject(CASH_REPOSITORY) private readonly repo: CashRepository,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly media: Pick<MediaAssetRepository, 'findManyByIds'>,
		private readonly cash: CashService,
		private readonly ledger: LedgerService,
		private readonly numbers: DocumentNumbersService,
		private readonly log: EditLogService,
	) {}

	/** A claim for oneself, or (a manager) for another staff member, at a location the person may see. */
	async create(
		write: ExpenseClaimWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<ExpenseClaim> {
		const access = await this.cash.access(principal);
		if (!access.all && !access.locationIds.includes(write.locationId))
			throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		const staffUserId = write.staffUserId ?? access.userId;
		if (!staffUserId) throw refuse('staff_unknown');
		if (staffUserId !== access.userId && !access.manager)
			throw new ForbiddenException(accountsRefusal('claim_for_another'));
		const staffName = (await this.cash.names([staffUserId]))(staffUserId);
		if (!staffName) throw refuse('staff_unknown');
		const head = ledgersUnder(await this.ledger.chart(), 'petty_expenses').find((l) => l.id === write.headLedgerId);
		if (!head) throw refuse('not_a_petty_head');
		const settings = await this.cash.settings();
		if (write.amountPaise > settings.rules.billPhotoOverPaise && !write.billMediaId)
			throw refuse('bill_photo_required');
		const bill = write.billMediaId ? (await this.media.findManyByIds([write.billMediaId]))[0] : null;
		if (write.billMediaId && !bill) throw refuse('bill_not_found');
		const id = `ec_${randomUUID()}`;
		const at = now.toISOString();
		const claim = await this.tx.withTransaction(async (context) => {
			const row: ExpenseClaim = {
				id,
				number: await this.numbers.issue('expenseClaim', context, now),
				staffUserId,
				staffName,
				locationId: write.locationId,
				headLedgerId: head.id,
				headName: head.name,
				amountPaise: write.amountPaise,
				whatFor: write.whatFor,
				billMediaId: write.billMediaId,
				billName: bill?.slug ?? null,
				spentOn: write.spentOn,
				status: 'waiting',
				payBack: null,
				payBoxId: null,
				bankLedgerId: null,
				payrollMonth: null,
				decidedAt: null,
				decidedBy: null,
				rejectReason: null,
				approvalVoucherId: null,
				paymentVoucherId: null,
				paidAt: null,
				createdAt: at,
				createdBy: access.userId,
				version: 0,
			};
			await this.repo.insertClaim(row, context);
			return row;
		});
		await this.log.append(access.userId, 'cash.claim.create', 'expenseClaim', id, [], {
			number: claim.number,
			amountPaise: claim.amountPaise,
		});
		return claim;
	}

	private async claimFor(id: string, access: CashAccess, context?: TransactionContext): Promise<ExpenseClaim> {
		const claim = await this.repo.claim(id, context);
		if (!claim) throw new NotFoundException(accountsRefusal('expense_claim_not_found'));
		if (!access.all && !access.locationIds.includes(claim.locationId))
			throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		return claim;
	}

	async get(
		id: string,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<ExpenseClaim & { locationName: string }> {
		const access = await this.cash.access(principal);
		const claim = await this.claimFor(id, access);
		const place = (await this.locations.list()).find((l) => l.id === claim.locationId);
		return { ...claim, locationName: place?.name ?? '' };
	}

	/** O12 Approve (with how it is paid back) or Reject (with why): a manager's step, never on one's own claim. */
	async decide(
		id: string,
		write: ClaimDecisionWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<ExpenseClaim> {
		const access = await this.cash.access(principal);
		const chart = await this.ledger.chart();
		const decided = await this.tx.withTransaction(async (context) => {
			const claim = await this.claimFor(id, access, context);
			if (claim.status !== 'waiting') throw new ConflictException(accountsRefusal('expense_claim_decided'));
			if (claim.staffUserId === access.userId && !access.superAdmin)
				throw new ForbiddenException(accountsRefusal('claim_own_approval'));
			const at = now.toISOString();
			const base = { ...claim, decidedAt: at, decidedBy: access.userId };
			if (write.decision === 'reject')
				return this.save({ ...base, status: 'rejected', rejectReason: write.reason }, write.version, context);
			const today = istDay(now);
			const approval = await this.ledger.post(
				{
					kind: 'journal',
					date: today,
					narration: `Expense claim ${claim.number} · ${claim.staffName} · ${claim.headName}`,
					lines: claimApprovalPosting(claim.headLedgerId, claim.amountPaise).map((line) => ({
						...line,
						locationId: claim.locationId,
					})),
					source: { type: 'expenseClaim', id: claim.id, number: claim.number },
					idempotencyKey: `expenseClaim:${claim.id}`,
				},
				context,
				access.userId,
			);
			const approved = { ...base, payBack: write.payBack, approvalVoucherId: approval.id };
			if (write.payBack === 'salary')
				return this.save(
					{ ...approved, status: 'approved', payrollMonth: today.slice(0, 7) },
					write.version,
					context,
				);
			const from = await this.payFrom(write, chart, access, context);
			const payment = await this.ledger.post(
				{
					kind: 'payment',
					date: today,
					narration: `Expense claim ${claim.number} paid back · ${claim.staffName}`,
					lines: claimPaymentPosting(from.ledgerId, claim.amountPaise).map((line) => ({
						...line,
						locationId: from.locationId ?? claim.locationId,
					})),
					source: { type: 'expenseClaimPayment', id: claim.id, number: claim.number },
					idempotencyKey: `expenseClaimPayment:${claim.id}`,
				},
				context,
				access.userId,
			);
			return this.save(
				{
					...approved,
					status: 'paid',
					payBoxId: from.boxId,
					bankLedgerId: from.boxId ? null : from.ledgerId,
					paymentVoucherId: payment.id,
					paidAt: at,
				},
				write.version,
				context,
			);
		});
		await this.log.append(access.userId, `cash.claim.${write.decision}`, 'expenseClaim', id, [], {
			number: decided.number,
			status: decided.status,
		});
		return decided;
	}

	/** Where a claim is paid back from: a box with its sheet open, or a bank. */
	private async payFrom(
		write: Extract<ClaimDecisionWrite, { decision: 'approve' }>,
		chart: Awaited<ReturnType<LedgerService['chart']>>,
		access: CashAccess,
		context: TransactionContext,
	): Promise<{ ledgerId: string; boxId: string | null; locationId: string | null }> {
		if (write.payBack === 'petty') {
			if (!write.payBoxId) throw refuse('claim_needs_a_box');
			const box = await this.cash.boxIn(write.payBoxId, access, context);
			if (!(await this.repo.openSheet(box.id, context)))
				throw new ConflictException(accountsRefusal('cash_sheet_not_open'));
			return { ledgerId: box.ledgerId, boxId: box.id, locationId: box.locationId };
		}
		if (!write.bankLedgerId || !isBank(chart, write.bankLedgerId)) throw refuse('cash_move_needs_bank');
		return { ledgerId: write.bankLedgerId, boxId: null, locationId: null };
	}

	private async save(claim: ExpenseClaim, version: number, context: TransactionContext): Promise<ExpenseClaim> {
		return this.repo.saveClaim(claim, version, context).catch((error: unknown) => {
			if ((error as Error).message === 'expense_claim_changed')
				throw new ConflictException(accountsRefusal('expense_claim_changed'));
			throw error;
		});
	}

	async list(query: ClaimListQuery, principal: AuthenticatedPrincipal | undefined): Promise<ClaimList> {
		const access = await this.cash.access(principal);
		const [page, places] = await Promise.all([
			this.repo.listClaims({ ...query, locationIds: access.all ? null : access.locationIds }),
			this.locations.list(),
		]);
		const placeName = new Map(places.map((p) => [p.id, p.name]));
		return {
			items: page.items.map((c) => ({ ...c, locationName: placeName.get(c.locationId) ?? '' })),
			total: page.total,
			counts: page.counts,
		};
	}
}
