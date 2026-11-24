import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type {
	PettyCheck,
	PettyExpense,
	PettyExpenseWrite,
	PettyList,
	PettyListQuery,
	RefillPreview,
	RefillWrite,
} from '@saha-textile/contracts';
import {
	gstInside,
	istDay,
	pettyPosting,
	refillOf,
	withinCashLimit,
	type CashRepository,
	type CompanyRepository,
	type LocationRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { AccountsTemplatesService } from '../accounts-templates/accounts-templates.service';
import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { CASH_REPOSITORY, COMPANY_REPOSITORY, LOCATION_REPOSITORY, TRANSACTION_MANAGER } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { EditLogService } from '../ledger/edit-log';
import { LedgerService } from '../ledger/ledger.service';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';
import { isBank, ledgersUnder, stateOf } from './cash-books';
import { CashService } from './cash.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));

/**
 * Petty expenses (accounts brief O4) paid from a box's open sheet, and refills of a fixed float (O13). Each posts its
 * own voucher in the same step, so its line lands on the sheet by itself.
 */
@Injectable()
export class PettyService {
	constructor(
		@Inject(CASH_REPOSITORY) private readonly repo: CashRepository,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(COMPANY_REPOSITORY) private readonly company: Pick<CompanyRepository, 'getRegistration'>,
		private readonly cash: CashService,
		private readonly ledger: LedgerService,
		private readonly templates: AccountsTemplatesService,
		private readonly numbers: DocumentNumbersService,
		private readonly log: EditLogService,
	) {}

	/** O4's checks: today's cash to the payee against the limit, an open sheet, and whether a bill is needed. */
	async check(
		boxId: string,
		paidTo: string,
		amountPaise: number,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<PettyCheck> {
		const access = await this.cash.access(principal);
		const box = await this.cash.boxIn(boxId, access);
		const today = istDay(now);
		const [paidToday, limitINR, open, settings] = await Promise.all([
			paidTo ? this.repo.pettyPaidOn(today, paidTo) : 0,
			this.templates.limitOn('cash_payment_one_person', today),
			this.repo.openSheet(box.id),
			this.cash.settings(),
		]);
		const limitPaise = limitINR === null ? null : Math.round(limitINR * 100);
		return {
			paidTodayPaise: paidToday,
			limitPaise,
			withinLimit: withinCashLimit(paidToday, amountPaise, limitPaise),
			sheetOpen: !!open,
			openedAt: open?.openedAt ?? null,
			billNeeded: amountPaise > settings.rules.billPhotoOverPaise,
		};
	}

	/** O4 "Pay from the till": numbered, posted to its head (with input GST on a GST bill), from the box's open sheet. */
	async pay(
		write: PettyExpenseWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<PettyExpense> {
		const access = await this.cash.access(principal);
		const box = await this.cash.boxIn(write.boxId, access);
		const checks = await this.check(box.id, write.paidTo, write.amountPaise, principal, now);
		if (!checks.sheetOpen) throw new ConflictException(accountsRefusal('cash_sheet_not_open'));
		if (checks.billNeeded && !write.billMediaId) throw refuse('bill_photo_required');
		if (!checks.withinLimit) throw refuse('cash_limit_exceeded');
		const chart = await this.ledger.chart();
		const head = ledgersUnder(chart, 'petty_expenses').find((l) => l.id === write.headLedgerId);
		if (!head) throw refuse('not_a_petty_head');
		const gst = write.gst ? await this.gstOf(write.gst, write.amountPaise, box.locationId) : null;
		const today = istDay(now);
		const id = `pc_${randomUUID()}`;
		const expense = await this.tx.withTransaction(async (context) => {
			// Closed since the checks: nothing is paid from a closed till.
			const sheet = await this.repo.openSheet(box.id, context);
			if (!sheet) throw new ConflictException(accountsRefusal('cash_sheet_not_open'));
			const number = await this.numbers.issue('pettyExpense', context, now);
			const voucher = await this.cash.post(
				{
					date: today,
					lines: pettyPosting({ headLedgerId: head.id, amountPaise: write.amountPaise, gst }, box.ledgerId),
				},
				box,
				{
					narration: `Petty expense · ${head.name} · ${write.paidTo}`,
					source: { type: 'pettyExpense', id, number },
					key: `pettyExpense:${id}`,
					kind: 'payment',
					by: access.userId,
					context,
				},
			);
			const row: PettyExpense = {
				id,
				number,
				boxId: box.id,
				sheetId: sheet.id,
				locationId: box.locationId,
				date: today,
				headLedgerId: head.id,
				headName: head.name,
				amountPaise: write.amountPaise,
				paidTo: write.paidTo,
				whatFor: write.whatFor,
				billMediaId: write.billMediaId,
				gst,
				voucherId: voucher.id,
				refillId: null,
				createdAt: now.toISOString(),
				createdBy: access.userId,
			};
			await this.repo.insertPetty(row, context);
			return row;
		});
		await this.log.append(access.userId, 'cash.petty.pay', 'pettyExpense', id, [], {
			number: expense.number,
			amountPaise: expense.amountPaise,
			box: box.name,
		});
		return expense;
	}

	/** A GST bill with our GSTIN: the tax inside the amount, split by whether the supplier is in our State. */
	private async gstOf(
		bill: NonNullable<PettyExpenseWrite['gst']>,
		amountPaise: number,
		locationId: string,
	): Promise<NonNullable<PettyExpense['gst']>> {
		const location = (await this.locations.list()).find((l) => l.id === locationId);
		const registration = location?.gstRegistrationId
			? await this.company.getRegistration(location.gstRegistrationId)
			: null;
		if (!registration) throw refuse('petty_gst_needs_our_gstin');
		const interState = stateOf(bill.supplierGstin) !== stateOf(registration.gstin);
		return { ...bill, ...gstInside(amountPaise, bill.ratePercent, interState) };
	}

	async list(query: PettyListQuery, principal: AuthenticatedPrincipal | undefined): Promise<PettyList> {
		const access = await this.cash.access(principal);
		const boxes = (await this.repo.boxes()).filter((b) => access.all || access.locationIds.includes(b.locationId));
		const boxIds = query.boxId
			? boxes.filter((b) => b.id === query.boxId).map((b) => b.id)
			: boxes.map((b) => b.id);
		const page = await this.repo.listPetty({ ...query, boxIds: access.all && !query.boxId ? null : boxIds });
		const boxName = new Map(boxes.map((b) => [b.id, b.name]));
		const nameOf = await this.cash.names(page.items.map((p) => p.createdBy));
		return {
			...page,
			items: page.items.map((p) => ({ ...p, boxName: boxName.get(p.boxId) ?? '', byName: nameOf(p.createdBy) })),
		};
	}

	/** O13: what a fixed float spent since its last refill, by head, and what brings it back to its float. */
	async refillPreview(boxId: string, principal: AuthenticatedPrincipal | undefined): Promise<RefillPreview> {
		const access = await this.cash.access(principal);
		const box = await this.cash.boxIn(boxId, access);
		if (box.kind !== 'fixed_float') throw refuse('not_a_fixed_float');
		const [book, spent] = await Promise.all([this.cash.bookOf(box), this.repo.pettySinceRefill(box.id)]);
		return { box, ...refillOf(box.floatPaise, book, spent) };
	}

	/** O13 Refill: the float back from a bank (a cash withdrawal), and the expenses it covers marked as refilled. */
	async refill(
		boxId: string,
		write: RefillWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<RefillPreview> {
		const access = await this.cash.access(principal);
		const box = await this.cash.boxIn(boxId, access);
		if (box.kind !== 'fixed_float') throw refuse('not_a_fixed_float');
		if (!isBank(await this.ledger.chart(), write.fromLedgerId)) throw refuse('cash_move_needs_bank');
		const refillId = `rfl_${randomUUID()}`;
		await this.tx.withTransaction(async (context) => {
			const spent = await this.repo.pettySinceRefill(box.id, context);
			await this.cash.post(
				{
					date: istDay(now),
					lines: [
						{ ledger: { id: box.ledgerId }, debitPaise: write.amountPaise, creditPaise: 0 },
						{ ledger: { id: write.fromLedgerId }, debitPaise: 0, creditPaise: write.amountPaise },
					],
				},
				box,
				{
					narration: `Petty cash refill · ${box.name}`,
					source: { type: 'pettyRefill', id: refillId, number: null },
					key: `pettyRefill:${refillId}`,
					kind: 'contra',
					by: access.userId,
					context,
				},
			);
			await this.repo.markRefilled(
				spent.map((p) => p.id),
				refillId,
				context,
			);
		});
		await this.log.append(access.userId, 'cash.petty.refill', 'cashBox', box.id, [], {
			amountPaise: write.amountPaise,
		});
		return this.refillPreview(boxId, principal);
	}
}
