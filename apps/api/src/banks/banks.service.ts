import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	BankAccount,
	BankAccountList,
	BankAccountRow,
	BankAccountWrite,
	BankChip,
	IfscLookup,
	MoneyLanding,
} from '@saha-textile/contracts';
import {
	bankGroupFor,
	defaultStockLocation,
	ifscBank,
	maskedNumber,
	openingPosting,
	type BankRepository,
	type GeneralLedgerRepository,
	type LocationRepository,
	type MoneyLandingRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	BANK_REPOSITORY,
	GENERAL_LEDGER_REPOSITORY,
	LOCATION_REPOSITORY,
	MONEY_LANDING_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerService } from '../ledger/ledger.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));

/** Which chip an account counts under (BA1). */
export function chipOf(kind: BankAccount['kind']): Exclude<BankChip, 'all'> {
	if (kind === 'cash_credit' || kind === 'overdraft') return 'credit';
	return kind === 'fixed_deposit' ? 'deposits' : 'current';
}

/** What lands in a ledger, from Where money lands, by the setting's own key. */
const LANDS: readonly (keyof Omit<MoneyLanding, 'updatedAt' | 'updatedBy'>)[] = [
	'receivedByGateway',
	'receivedByUpi',
	'receivedByBank',
	'cashOnDelivery',
	'paidByBank',
	'paidInCash',
];

/**
 * Bank accounts (accounts brief BA1–BA3): each is a ledger under Bank accounts (a cash credit or overdraft under the
 * bank overdraft group) with the bank's details beside it, its opening balance posted on its day. The number shows
 * whole only to those who manage the accounts (`accounts.edit`).
 */
@Injectable()
export class BanksService {
	constructor(
		@Inject(BANK_REPOSITORY) private readonly repo: BankRepository,
		@Inject(GENERAL_LEDGER_REPOSITORY) private readonly books: Pick<GeneralLedgerRepository, 'balanceBefore'>,
		@Inject(MONEY_LANDING_REPOSITORY) private readonly landing: Pick<MoneyLandingRepository, 'get'>,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		private readonly ledger: LedgerService,
	) {}

	private manages(principal: AuthenticatedPrincipal | undefined): boolean {
		return !!principal?.permissions.includes('accounts.edit');
	}

	private async row(account: BankAccount, whole: boolean, landing: MoneyLanding | null): Promise<BankAccountRow> {
		return {
			...account,
			number: whole ? account.number : maskedNumber(account.number),
			numberShown: whole ? account.number : maskedNumber(account.number),
			balancePaise: await this.books.balanceBefore(account.ledgerId, '9999-12-31', []),
			lastStatementOn: null,
			toMatch: 0,
			lands: LANDS.filter((key) => landing?.[key] === account.ledgerId),
		};
	}

	async list(principal: AuthenticatedPrincipal | undefined): Promise<BankAccountList> {
		const whole = this.manages(principal);
		const [accounts, landing] = await Promise.all([this.repo.list(), this.landing.get()]);
		const items: BankAccountRow[] = [];
		for (const account of accounts) items.push(await this.row(account, whole, landing));
		const counts = { all: accounts.length, current: 0, credit: 0, deposits: 0 };
		for (const account of accounts) counts[chipOf(account.kind)] += 1;
		return { items, counts, manage: whole };
	}

	async get(id: string, principal: AuthenticatedPrincipal | undefined): Promise<BankAccountRow> {
		const account = await this.repo.get(id);
		if (!account) throw new NotFoundException(accountsRefusal('bank_account_not_found'));
		return this.row(account, this.manages(principal), await this.landing.get());
	}

	/** BA2: the bank the IFSC names, from the app's own list; anything else is typed. */
	ifsc(code: string): IfscLookup {
		return { ifsc: code.trim().toUpperCase(), bankName: ifscBank(code) };
	}

	private async groupFor(kind: BankAccount['kind']): Promise<string> {
		const chart = await this.ledger.chart();
		const key = bankGroupFor(kind);
		const group = chart.groups.find((g) => g.systemKey === key);
		if (!group) throw refuse(`voucher_problem:role_not_mapped:${key}`);
		return group.id;
	}

	/** BA2 Save on a new account: its ledger, the account, and the opening balance on its day, in one go. */
	async add(
		write: BankAccountWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<BankAccount> {
		if (write.openingINR && !write.openingOn) throw refuse('bank_opening_needs_date');
		const by = principal?.userId ?? null;
		const groupId = await this.groupFor(write.kind);
		// The opening posts at the account's location, else where the stock is kept by default.
		const locationId = write.locationId ?? defaultStockLocation(await this.locations.list());
		if (write.openingINR && !locationId) throw refuse('books_need_a_location');
		const at = now.toISOString();
		return this.tx.withTransaction(async (context) => {
			const ledger = await this.ledger.addLedger(
				{ name: write.shortName, groupId, active: write.active, expectedUpdatedAt: null },
				by,
			);
			const id = `bank_${randomUUID()}`;
			let openingVoucherId: string | null = null;
			const rows = openingPosting(write.openingINR);
			if (rows.length) {
				const voucher = await this.ledger.post(
					{
						kind: 'opening',
						// An opening needs its day (refused above without one).
						date: write.openingOn as string,
						narration: `Opening balance of ${write.shortName}`,
						lines: rows.map((row) => ({
							ledger: row.role === 'bank' ? { id: ledger.id } : { role: row.role },
							locationId: locationId as string,
							...(row.debitPaise ? { debitPaise: row.debitPaise } : {}),
							...(row.creditPaise ? { creditPaise: row.creditPaise } : {}),
						})),
						source: { type: 'bankAccount', id },
						idempotencyKey: `bankOpening:${id}`,
					},
					context,
					by,
				);
				openingVoucherId = voucher.id;
			}
			const account: BankAccount = {
				...write,
				id,
				ledgerId: ledger.id,
				openingVoucherId,
				version: 0,
				createdAt: at,
				updatedAt: at,
				updatedBy: by,
			};
			await this.repo.insert(account, context);
			return account;
		});
	}

	/** BA2 Save on an account: its details, and its ledger's name and group; the opening balance stays as posted. */
	async edit(
		id: string,
		write: BankAccountWrite & { version: number },
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<BankAccount> {
		const current = await this.repo.get(id);
		if (!current) throw new NotFoundException(accountsRefusal('bank_account_not_found'));
		if (write.openingINR !== current.openingINR || write.openingOn !== current.openingOn)
			throw new ConflictException(accountsRefusal('bank_opening_is_posted'));
		const by = principal?.userId ?? null;
		const groupId = await this.groupFor(write.kind);
		return this.tx.withTransaction(async (context) => {
			await this.ledger.saveLedger(
				current.ledgerId,
				{ name: write.shortName, groupId, active: write.active, expectedUpdatedAt: null },
				by,
			);
			const { version, ...details } = write;
			return this.repo.save(
				{ ...current, ...details, updatedAt: now.toISOString(), updatedBy: by },
				version,
				context,
			);
		});
	}
}
