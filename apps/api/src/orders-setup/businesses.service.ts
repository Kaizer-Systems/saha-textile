import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import {
	Business,
	LedgerEntry,
	RETAIL_ZONE_ID,
	gstStateName,
	type BusinessBuyerOption,
	type BusinessListQuery,
	type BusinessListResponse,
	type BusinessReceiptWrite,
	type BusinessStandingWrite,
	type BusinessWrite,
	type LedgerQuery,
	type LedgerStatement,
	type SetOffSetting,
	type SetOffWrite,
} from '@saha-textile/contracts';
import {
	checkSetOff,
	entryOutstanding,
	istDay,
	type AuditLogRepository,
	type BusinessRepository,
	type LedgerRepository,
	type PriceZoneRepository,
	type PurchaseEntryRepository,
	type TransactionContext,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { codedRefusal } from '../common/coded-refusal';
import {
	AUDIT_LOG_REPOSITORY,
	BUSINESS_REPOSITORY,
	LEDGER_REPOSITORY,
	PRICE_ZONE_REPOSITORY,
	PURCHASE_ENTRY_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { DocumentNumbersService } from './document-numbers.service';
import { auditOrdersChange, refuseStale } from './orders-audit';

const round2 = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100;

/**
 * Customers › Businesses (brief bz01–bz06, so01–so04; owner 2026-11-16 and 2026-11-20): customers
 * and suppliers in one record, each side with its own account (receivable, payable), never netted
 * except by a set-off entry under a written agreement (off for Saha Textile). A business that buys
 * from us has one zone (RETAIL by default).
 */
/**
 * When a dated ledger entry (a receipt, a set-off) sits in the statement, so the running balance follows
 * what really happened: dated today, the moment it is recorded (after the orders placed earlier today);
 * dated earlier, the end of that day in India (after that day's orders, which it pays).
 */
export function entryMoment(day: string, now = new Date()): string {
	if (day === istDay(now)) return now.toISOString();
	return new Date(`${day}T23:59:59.999+05:30`).toISOString();
}

@Injectable()
export class BusinessesService {
	constructor(
		@Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository,
		@Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository,
		@Inject(PRICE_ZONE_REPOSITORY) private readonly zones: PriceZoneRepository,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
		private readonly numbers: DocumentNumbersService,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
		@Optional()
		@Inject(PURCHASE_ENTRY_REPOSITORY)
		private readonly purchases: PurchaseEntryRepository | null = null,
	) {}

	/**
	 * What we owe a business that sells to us: its posted purchase bills still unpaid (Purchases ›
	 * Suppliers) plus our own payable entries (set-offs and their reversals). One figure for the list,
	 * the business page and the set-off check (so02).
	 */
	async receivableINR(id: string): Promise<number> {
		return round2(await this.ledger.balance(id, 'receivable'));
	}

	async payableINR(id: string): Promise<number> {
		const bills = this.purchases ? await this.purchases.forSupplier(id) : [];
		const owed = bills
			.filter((entry) => entry.status === 'posted')
			.reduce((sum, entry) => sum + entryOutstanding(entry), 0);
		return round2(owed + (await this.ledger.balance(id, 'payable')));
	}

	async list(query: BusinessListQuery): Promise<BusinessListResponse> {
		const page = await this.businesses.list(query);
		const zones = new Map((await this.zones.list()).map((zone) => [zone.id, zone]));
		const items = await Promise.all(
			page.items.map(async (business) => {
				const owesUs = await this.ledger.balance(business.id, 'receivable');
				const weOwe = business.roles.supplier ? await this.payableINR(business.id) : 0;
				const customer = business.roles.customer;
				const zone = customer ? zones.get(customer.zoneId) : undefined;
				return {
					id: business.id,
					legalName: business.legalName,
					tradeName: business.tradeName,
					gstin: business.gstin,
					stateName: business.stateName,
					sellsToUs: business.roles.supplier,
					buysFromUs: !!customer,
					zone: zone ? { id: zone.id, code: zone.code, name: zone.name } : null,
					creditLimitINR: customer?.creditLimitINR ?? null,
					creditUsedINR: customer ? Math.max(0, owesUs) : null,
					owesUsINR: owesUs,
					weOweINR: weOwe,
					standing: customer?.standing ?? null,
					active: business.active,
				};
			}),
		);
		return {
			items,
			total: page.total,
			counts: {
				all: page.counts.all ?? 0,
				customer: page.counts.customer ?? 0,
				supplier: page.counts.supplier ?? 0,
				both: page.counts.both ?? 0,
				creditOnHold: page.counts.creditOnHold ?? 0,
				blocked: page.counts.blocked ?? 0,
			},
		};
	}

	async get(id: string): Promise<Business> {
		const business = await this.businesses.findById(id);
		if (!business) throw new NotFoundException('That business does not exist');
		return business;
	}

	/** The Create order picker: businesses that buy from us, found by name, phone or GSTIN (owner, 2026-11-20). */
	async searchBuyers(q: string, limit: number): Promise<BusinessBuyerOption[]> {
		const found = await this.businesses.searchBuyers(q, limit);
		const zones = new Map((await this.zones.list()).map((zone) => [zone.id, zone]));
		return Promise.all(
			found
				.filter((business) => business.roles.customer)
				.map(async (business) => {
					const customer = business.roles.customer as NonNullable<Business['roles']['customer']>;
					const zone = zones.get(customer.zoneId) ?? zones.get(RETAIL_ZONE_ID);
					const owes = await this.ledger.balance(business.id, 'receivable');
					const accounts = business.contacts.find((contact) => contact.isAccounts) ?? business.contacts[0];
					return {
						id: business.id,
						legalName: business.legalName,
						tradeName: business.tradeName,
						gstin: business.gstin,
						phone: accounts?.mobile
							? `+${accounts.mobile.countryCallingCode} ${accounts.mobile.number}`
							: null,
						zone: {
							id: zone?.id ?? RETAIL_ZONE_ID,
							code: zone?.code ?? 'RETAIL',
							name: zone?.name ?? 'Retail',
						},
						standing: customer.standing,
						creditLimitINR: customer.creditLimitINR,
						creditAvailableINR: round2(customer.creditLimitINR - Math.max(0, owes)),
						creditDays: customer.creditDays,
						standingReason: customer.standingReason,
						standingBy: customer.standingBy,
						standingAt: customer.standingAt,
					};
				}),
		);
	}

	async create(
		input: BusinessWrite,
		actor: string | null,
		mayAssignZone: boolean,
		maySetCredit: boolean,
	): Promise<Business> {
		const now = new Date().toISOString();
		const zoneId = await this.zoneFor(input.customer?.zoneId ?? RETAIL_ZONE_ID, mayAssignZone);
		const business = Business.parse({
			id: `biz_${randomUUID()}`,
			legalName: input.legalName,
			tradeName: input.tradeName,
			businessType: input.businessType,
			gstin: input.gstin,
			pan: input.pan ?? (input.gstin ? input.gstin.slice(2, 12) : null),
			stateCode: input.stateCode,
			stateName: gstStateName(input.stateCode) ?? '',
			registeredAddress: input.registeredAddress,
			addresses: [],
			contacts: input.contacts.map((contact) => ({ ...contact, id: contact.id ?? `bct_${randomUUID()}` })),
			roles: {
				supplier: input.sellsToUs,
				customer: input.customer
					? {
							zoneId,
							creditLimitINR: maySetCredit ? input.customer.creditLimitINR : 0,
							creditDays: maySetCredit ? input.customer.creditDays : 0,
							standing: 'active',
							standingReason: null,
							standingBy: null,
							standingAt: null,
						}
					: null,
			},
			setOff: { mode: 'never' },
			active: input.active,
			notes: input.notes,
			revision: 0,
			createdAt: now,
			updatedAt: now,
		});
		const saved = await this.businesses.save(business, null);
		await auditOrdersChange(this.audit, actor, 'business.create', 'business', saved.id, {
			legalName: saved.legalName,
			roles: saved.roles,
		});
		return saved;
	}

	async update(
		id: string,
		input: BusinessWrite,
		actor: string | null,
		mayAssignZone: boolean,
		maySetCredit: boolean,
	): Promise<Business> {
		const current = await this.get(id);
		if (input.revision === undefined)
			throw new BadRequestException(
				codedRefusal('revision_required', 'Send the revision you edited', 'revision'),
			);
		const was = current.roles.customer;
		const zoneId = input.customer
			? input.customer.zoneId === was?.zoneId
				? input.customer.zoneId
				: await this.zoneFor(input.customer.zoneId, mayAssignZone)
			: null;
		const next = Business.parse({
			...current,
			legalName: input.legalName,
			tradeName: input.tradeName,
			businessType: input.businessType,
			gstin: input.gstin,
			pan: input.pan ?? current.pan,
			stateCode: input.stateCode,
			stateName: gstStateName(input.stateCode) ?? current.stateName,
			registeredAddress: input.registeredAddress,
			contacts: input.contacts.map((contact) => ({ ...contact, id: contact.id ?? `bct_${randomUUID()}` })),
			roles: {
				supplier: input.sellsToUs,
				customer: input.customer
					? {
							zoneId,
							creditLimitINR: maySetCredit ? input.customer.creditLimitINR : (was?.creditLimitINR ?? 0),
							creditDays: maySetCredit ? input.customer.creditDays : (was?.creditDays ?? 0),
							standing: was?.standing ?? 'active',
							standingReason: was?.standingReason ?? null,
							standingBy: was?.standingBy ?? null,
							standingAt: was?.standingAt ?? null,
						}
					: null,
			},
			active: input.active,
			notes: input.notes,
			updatedAt: new Date().toISOString(),
		});
		const revision = input.revision;
		const saved = await refuseStale(
			() => this.businesses.save(next, revision),
			'Someone else saved this business first',
		);
		await auditOrdersChange(this.audit, actor, 'business.update', 'business', id, { roles: saved.roles });
		return saved;
	}

	/** Active · Credit on hold · Blocked, with a reason, who and when (bz05). */
	async setStanding(id: string, input: BusinessStandingWrite, actor: string | null): Promise<Business> {
		const current = await this.get(id);
		const customer = current.roles.customer;
		if (!customer)
			throw new ConflictException(
				codedRefusal('not_a_customer', 'This business does not buy from us', 'standing'),
			);
		const now = new Date().toISOString();
		const next = {
			...current,
			roles: {
				...current.roles,
				customer: {
					...customer,
					standing: input.standing,
					standingReason: input.reason,
					standingBy: actor,
					standingAt: now,
				},
			},
			updatedAt: now,
		};
		const saved = await refuseStale(
			() => this.businesses.save(next, current.revision),
			'Someone else saved this business first',
		);
		await auditOrdersChange(this.audit, actor, 'business.standing', 'business', id, {
			standing: input.standing,
			reason: input.reason,
		});
		return saved;
	}

	async setZone(id: string, zoneId: string, actor: string | null): Promise<Business> {
		const current = await this.get(id);
		const customer = current.roles.customer;
		if (!customer)
			throw new ConflictException(codedRefusal('not_a_customer', 'This business does not buy from us', 'zoneId'));
		await this.zoneFor(zoneId, true);
		const next = {
			...current,
			roles: { ...current.roles, customer: { ...customer, zoneId } },
			updatedAt: new Date().toISOString(),
		};
		const saved = await refuseStale(
			() => this.businesses.save(next, current.revision),
			'Someone else saved this business first',
		);
		await auditOrdersChange(this.audit, actor, 'business.zone', 'business', id, {
			from: customer.zoneId,
			to: zoneId,
		});
		return saved;
	}

	async statement(id: string, query: LedgerQuery): Promise<LedgerStatement> {
		await this.get(id);
		const page = await this.ledger.list(id, query.side, {
			from: query.from,
			to: query.to,
			page: query.page,
			pageSize: query.pageSize,
		});
		// The payable side starts from the unpaid purchase bills; our own entries are set-offs against them.
		const openingINR =
			query.side === 'payable'
				? round2(page.openingINR + (await this.payableINR(id)) - (await this.ledger.balance(id, 'payable')))
				: page.openingINR;
		let running = openingINR;
		const rows = page.rows.map((row) => {
			running = round2(running + row.amountINR);
			return { ...row, balanceINR: running };
		});
		return { side: query.side, openingINR, rows, closingINR: running, total: page.total };
	}

	/**
	 * A receipt on the customer account (RC number). The orders it settles (bz06) are recorded by the
	 * caller in the same transaction when one is passed.
	 */
	async recordReceipt(
		id: string,
		input: BusinessReceiptWrite,
		actor: string | null,
		outer?: TransactionContext,
	): Promise<LedgerEntry> {
		const business = await this.get(id);
		if (!business.roles.customer)
			throw new ConflictException(
				codedRefusal('not_a_customer', 'This business does not buy from us', 'amountINR'),
			);
		const write = async (context: TransactionContext) => {
			const number = await this.numbers.issue('receipt', context);
			return this.ledger.append(
				LedgerEntry.parse({
					id: `led_${randomUUID()}`,
					businessId: id,
					side: 'receivable',
					kind: 'receipt',
					amountINR: -input.amountINR,
					documentType: 'receipt',
					documentId: `rcpt_${randomUUID()}`,
					documentNumber: number,
					note: [input.method, input.reference, input.note].filter(Boolean).join(' · ').slice(0, 500),
					at: entryMoment(input.receivedOn),
					by: actor ?? 'system',
				}),
				context,
			);
		};
		const entry = outer ? await write(outer) : await this.transactions.withTransaction(write);
		await auditOrdersChange(this.audit, actor, 'business.receipt', 'business', id, {
			amountINR: input.amountINR,
			number: entry.documentNumber,
		});
		return entry;
	}

	/**
	 * Undoes a set-off (so04): never edited or deleted; a reversing journal entry with its own reason,
	 * in both accounts. A set-off can be reversed once.
	 */
	async reverseSetOff(id: string, documentId: string, reason: string, actor: string | null): Promise<LedgerEntry[]> {
		await this.get(id);
		const rowsOf = (side: 'receivable' | 'payable') =>
			this.ledger.list(id, side, { page: 1, pageSize: 1000 }).then((page) => page.rows);
		// Read as a pair, so both lists are typed as there (two never-run `?? []` went).
		const [receivable, payable] = await Promise.all([rowsOf('receivable'), rowsOf('payable')]);
		const all = [...receivable, ...payable];
		const originals = all.filter((row) => row.documentId === documentId && row.kind === 'setOff');
		if (!originals.length) {
			throw new NotFoundException(codedRefusal('setoff_missing', 'That set-off does not exist', 'documentId'));
		}
		if (all.some((row) => row.reversalOf && originals.some((original) => original.id === row.reversalOf))) {
			throw new ConflictException(
				codedRefusal('setoff_already_reversed', 'That set-off was already reversed', 'documentId'),
			);
		}
		const entries = await this.transactions.withTransaction(async (context) => {
			const number = await this.numbers.issue('journal', context);
			const reversalId = `jv_${randomUUID()}`;
			const at = new Date().toISOString();
			return Promise.all(
				originals.map((original) =>
					this.ledger.append(
						LedgerEntry.parse({
							id: `led_${randomUUID()}`,
							businessId: id,
							side: original.side,
							kind: 'reversal',
							amountINR: -original.amountINR,
							documentType: 'journal',
							documentId: reversalId,
							documentNumber: number,
							note: reason,
							reversalOf: original.id,
							agreement: null,
							at,
							by: actor ?? 'system',
						}),
						context,
					),
				),
			);
		});
		await auditOrdersChange(this.audit, actor, 'business.setoff_reversed', 'business', id, {
			documentId,
			number: entries[0]?.documentNumber,
		});
		return entries;
	}

	async setSetOff(id: string, input: SetOffSetting, actor: string | null): Promise<Business> {
		const current = await this.get(id);
		const saved = await refuseStale(
			() =>
				this.businesses.save(
					{ ...current, setOff: input, updatedAt: new Date().toISOString() },
					current.revision,
				),
			'Someone else saved this business first',
		);
		await auditOrdersChange(this.audit, actor, 'business.setoff_setting', 'business', id, { mode: input.mode });
		return saved;
	}

	/** One journal entry (JV) shown in both accounts, at most the smaller balance (so02, so03). */
	async recordSetOff(id: string, input: SetOffWrite, actor: string | null): Promise<LedgerEntry[]> {
		const business = await this.get(id);
		const [receivable, payable] = await Promise.all([this.ledger.balance(id, 'receivable'), this.payableINR(id)]);
		const refusal = checkSetOff({
			setting:
				business.setOff.mode === 'agreement'
					? { mode: 'agreement', signedOn: business.setOff.signedOn, validUntil: business.setOff.validUntil }
					: { mode: 'never' },
			basis: input.basis.kind,
			receivableINR: receivable,
			payableINR: payable,
			amountINR: input.amountINR,
			today: istDay(new Date()),
		});
		if (refusal)
			throw new ConflictException(
				codedRefusal(`setoff_${refusal}`, 'This set-off can’t be recorded', 'amountINR', {
					receivableINR: receivable,
					payableINR: payable,
				}),
			);
		const agreement =
			input.basis.kind === 'oneOff'
				? { reference: input.basis.reference, signedOn: input.basis.signedOn, mediaId: input.basis.mediaId }
				: null;
		const entries = await this.transactions.withTransaction(async (context) => {
			const number = await this.numbers.issue('journal', context);
			const documentId = `jv_${randomUUID()}`;
			const at = input.on ? entryMoment(input.on) : new Date().toISOString();
			const base = {
				businessId: id,
				kind: 'setOff' as const,
				documentType: 'journal',
				documentId,
				documentNumber: number,
				note: input.note,
				agreement,
				at,
				by: actor ?? 'system',
			};
			return Promise.all([
				this.ledger.append(
					LedgerEntry.parse({
						...base,
						id: `led_${randomUUID()}`,
						side: 'receivable',
						amountINR: -input.amountINR,
					}),
					context,
				),
				this.ledger.append(
					LedgerEntry.parse({
						...base,
						id: `led_${randomUUID()}`,
						side: 'payable',
						amountINR: -input.amountINR,
					}),
					context,
				),
			]);
		});
		await auditOrdersChange(this.audit, actor, 'business.setoff', 'business', id, {
			amountINR: input.amountINR,
			number: entries[0]?.documentNumber,
		});
		return entries;
	}

	private async zoneFor(zoneId: string, mayAssign: boolean): Promise<string> {
		if (zoneId !== RETAIL_ZONE_ID && !mayAssign) {
			throw new ConflictException(
				codedRefusal('zone_assign_forbidden', 'Assigning a zone needs its own permission', 'customer.zoneId'),
			);
		}
		const zone = await this.zones.findById(zoneId);
		if (!zone || zone.status === 'archived')
			throw new BadRequestException(codedRefusal('zone_unknown', 'That zone does not exist', 'customer.zoneId'));
		return zone.id;
	}
}
