import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	Settlement,
	SettlementImportWrite,
	SettlementKind,
	SettlementList,
	SettlementListQuery,
	SettlementPreview,
	SettlementRow,
	SettlementRowWrite,
} from '@saha-textile/contracts';
import {
	UNSETTLED_AFTER_DAYS,
	UNSETTLED_LOOKBACK_DAYS,
	defaultStockLocation,
	istDay,
	payoutProblem,
	payoutsOf,
	settlementRows,
	type AdminOrderRepository,
	type AuditLogRepository,
	type BankRepository,
	type LocationRepository,
	type MoneyLandingRepository,
	type OrderPaymentRepository,
	type SettlementRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADMIN_ORDER_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	BANK_REPOSITORY,
	LOCATION_REPOSITORY,
	MONEY_LANDING_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	SETTLEMENT_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { BooksPostingService } from '../ledger/books-posting';
import { LedgerService } from '../ledger/ledger.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));

const shift = (day: string, days: number) =>
	new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The gateway a provider's name means; others are matched by order number only. */
const GATEWAYS: Record<string, string> = { ccavenue: 'ccavenue', paypal: 'paypal' };

/**
 * Settlements (accounts brief Q10, D27): a gateway's payout file or a courier's COD remittance file, read in the admin,
 * becomes one settlement per payout. Each row is matched to the order payment it pays (the gateway's own payment id,
 * else the order number), and each payout posts Bank, the charges and their input GST against Gateway clearing or COD
 * receivable. A payout is imported once per provider; gateway payments no payout has paid after 7 days are listed.
 */
@Injectable()
export class SettlementsService {
	constructor(
		@Inject(SETTLEMENT_REPOSITORY) private readonly repo: SettlementRepository,
		@Inject(BANK_REPOSITORY) private readonly banks: Pick<BankRepository, 'get'>,
		@Inject(ORDER_PAYMENT_REPOSITORY)
		private readonly payments: Pick<
			OrderPaymentRepository,
			'findByGatewayReference' | 'listByOrder' | 'listGatewayReceived'
		>,
		@Inject(ADMIN_ORDER_REPOSITORY)
		private readonly orders: Pick<AdminOrderRepository, 'findById' | 'findByNumber'>,
		@Inject(MONEY_LANDING_REPOSITORY) private readonly landing: Pick<MoneyLandingRepository, 'get'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
		private readonly ledger: LedgerService,
		private readonly books: BooksPostingService,
	) {}

	/** A row's order payment: by the gateway's own payment id, else by the order number. */
	private async matchRow(kind: SettlementKind, provider: string, row: SettlementRowWrite): Promise<SettlementRow> {
		const base = {
			reference: row.reference,
			grossPaise: row.grossPaise,
			chargesPaise: row.chargesPaise,
			gstPaise: row.gstPaise,
		};
		const gateway = GATEWAYS[provider.trim().toLowerCase()];
		const byGateway =
			kind === 'gateway' && gateway ? await this.payments.findByGatewayReference(gateway, row.reference) : null;
		if (byGateway) {
			const order = await this.orders.findById(byGateway.orderId);
			return {
				...base,
				orderId: byGateway.orderId,
				orderNumber: order?.orderNumber ?? null,
				paymentId: byGateway.id,
			};
		}
		const order = await this.orders.findByNumber(row.reference);
		if (!order) return { ...base, orderId: null, orderNumber: null, paymentId: null };
		const method = kind === 'gateway' ? 'gateway' : 'cashOnDelivery';
		const payment = (await this.payments.listByOrder(order.id)).find((p) => p.method === method);
		return { ...base, orderId: order.id, orderNumber: order.orderNumber, paymentId: payment?.id ?? null };
	}

	/** Q10 before saving: the file's payouts with their rows matched, each marked when imported already. */
	async preview(write: SettlementImportWrite): Promise<SettlementPreview> {
		const payouts = payoutsOf(write.rows);
		const already = await this.repo.payoutReferencesIn(
			write.kind,
			write.provider,
			payouts.map((p) => p.payoutReference),
		);
		return {
			payouts: await Promise.all(
				payouts.map(async (payout) => {
					const rows = await Promise.all(
						payout.rows.map((row) => this.matchRow(write.kind, write.provider, row)),
					);
					return {
						payoutReference: payout.payoutReference,
						date: payout.date,
						rows,
						grossPaise: payout.grossPaise,
						chargesPaise: payout.chargesPaise,
						gstPaise: payout.gstPaise,
						netPaise: payout.netPaise,
						matched: rows.filter((r) => r.paymentId).length,
						already: already.has(payout.payoutReference),
					};
				}),
			),
		};
	}

	/** Q10 Import: every payout not imported before is saved and posted, each in its own transaction. */
	async import(write: SettlementImportWrite, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const account = await this.banks.get(write.bankAccountId);
		if (!account) throw new NotFoundException(accountsRefusal('bank_account_not_found'));
		const preview = await this.preview(write);
		const fresh = preview.payouts.filter((p) => !p.already);
		for (const payout of fresh) {
			const problem = payoutProblem(payout);
			if (problem) throw refuse(`${problem}:${payout.payoutReference}`);
		}
		const posts = await this.books.willPost();
		const [landing, locations] = await Promise.all([this.landing.get(), this.locations.list()]);
		const locationId = account.locationId ?? defaultStockLocation(locations);
		if (posts && fresh.length && !locationId) throw refuse('books_need_a_location');
		const by = principal?.userId ?? null;
		const saved: Settlement[] = [];
		for (const payout of fresh) {
			const id = `stl_${randomUUID()}`;
			const settlement = await this.tx.withTransaction(async (context) => {
				const voucher = posts
					? await this.ledger.post(
							{
								kind: 'receipt',
								date: payout.date,
								narration: `${write.provider} payout ${payout.payoutReference}`,
								source: { type: 'settlement', id, number: payout.payoutReference },
								idempotencyKey: `settlement:${write.kind}:${write.provider}:${payout.payoutReference}`,
								lines: settlementRows(write.kind, payout, { id: account.ledgerId }, landing).map(
									(row) => ({
										...row,
										locationId: locationId as string,
									}),
								),
							},
							context,
							by,
						)
					: null;
				const entry: Settlement = {
					id,
					kind: write.kind,
					provider: write.provider,
					payoutReference: payout.payoutReference,
					date: payout.date,
					bankAccountId: account.id,
					rows: payout.rows,
					grossPaise: payout.grossPaise,
					chargesPaise: payout.chargesPaise,
					gstPaise: payout.gstPaise,
					netPaise: payout.netPaise,
					matched: payout.matched,
					voucherId: voucher?.id ?? null,
					fileName: write.fileName,
					createdAt: now.toISOString(),
					createdBy: by,
				};
				await this.repo.insert(entry, context);
				await this.audit.append(
					{
						id: `aud_${randomUUID()}`,
						actorUserId: by,
						targetUserId: null,
						audience: 'admin',
						action: 'settlement.import',
						entityType: 'settlement',
						entityId: id,
						severity: 'info',
						retentionTier: 'books',
						diffs: [],
						metadata: {
							provider: write.provider,
							payoutReference: payout.payoutReference,
							netPaise: payout.netPaise,
							matched: `${payout.matched} of ${payout.rows.length}`,
						},
						requestId: null,
						ipHash: null,
						userAgentHash: null,
						createdAt: now.toISOString(),
					},
					context,
				);
				return entry;
			});
			saved.push(settlement);
		}
		return { saved, skipped: preview.payouts.filter((p) => p.already).map((p) => p.payoutReference) };
	}

	/** Q10's list: a kind's payouts in the period, and gateway payments no payout has paid after 7 days. */
	async list(query: SettlementListQuery, now = new Date()): Promise<SettlementList> {
		const today = istDay(now);
		const [page, received] = await Promise.all([
			this.repo.list(query),
			this.payments.listGatewayReceived(
				shift(today, -UNSETTLED_LOOKBACK_DAYS),
				shift(today, -UNSETTLED_AFTER_DAYS),
			),
		]);
		const settled = await this.repo.settledPaymentIds(received.map((p) => p.id));
		return {
			...page,
			unsettled: received
				.filter((p) => !settled.has(p.id))
				.map((p) => ({
					paymentId: p.id,
					orderId: p.orderId,
					gateway: p.gateway?.id ?? 'gateway',
					reference: p.gateway?.reference ?? p.reference,
					receivedOn: p.receivedOn as string,
					amountINR: p.amountINR,
				})),
		};
	}

	async get(id: string): Promise<Settlement> {
		const settlement = await this.repo.get(id);
		if (!settlement) throw new NotFoundException(accountsRefusal('settlement_not_found'));
		return settlement;
	}
}
