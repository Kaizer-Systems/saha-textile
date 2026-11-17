import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
	type Supplier,
	type SupplierGstinCheck,
	type SupplierListQuery,
	type SupplierListResponse,
	type SupplierSummary,
	type SupplierWrite,
	gstStateName,
	gstinProblem,
	panFromGstin,
} from '@saha-textile/contracts';
import {
	type PurchaseEntryRepository,
	type PurchaseReturnRepository,
	type SupplierItemCodeRepository,
	type SupplierPaymentRepository,
	type SupplierRepository,
	daysBetween,
	entryOutstanding,
	fiscalYearOf,
	purchaseTaxType,
	supplierStatement,
} from '@saha-textile/core-domain';

import {
	PURCHASE_ENTRY_REPOSITORY,
	PURCHASE_RETURN_REPOSITORY,
	SUPPLIER_ITEM_CODE_REPOSITORY,
	SUPPLIER_PAYMENT_REPOSITORY,
	SUPPLIER_REPOSITORY,
} from '../infra/tokens';
import { PurchasingSupport, missing, refuse } from './purchasing-support';

const fiscalYearStart = (fiscalYear: string): string => `${fiscalYear.slice(0, 4)}-04-01`;

/**
 * Suppliers (s01–s03). A supplier's GSTIN sets the tax on every bill from them: West Bengal
 * gives CGST + SGST, any other State IGST, composition and unregistered no GST lines.
 */
@Injectable()
export class SuppliersService {
	constructor(
		@Inject(SUPPLIER_REPOSITORY) private readonly suppliers: SupplierRepository,
		@Inject(SUPPLIER_ITEM_CODE_REPOSITORY) private readonly itemCodes: SupplierItemCodeRepository,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: PurchaseEntryRepository,
		@Inject(SUPPLIER_PAYMENT_REPOSITORY) private readonly payments: SupplierPaymentRepository,
		@Inject(PURCHASE_RETURN_REPOSITORY) private readonly returns: PurchaseReturnRepository,
		private readonly support: PurchasingSupport,
	) {}

	/** What each supplier is owed across their posted, unpaid bills. */
	private async owedBySupplier(): Promise<Map<string, number>> {
		const owed = new Map<string, number>();
		for (const entry of await this.entries.openPayables()) {
			const left = entryOutstanding(entry);
			owed.set(entry.supplierId, Math.round(((owed.get(entry.supplierId) ?? 0) + left) * 100) / 100);
		}
		return owed;
	}

	async list(query: SupplierListQuery): Promise<SupplierListResponse> {
		const owed = await this.owedBySupplier();
		const [page, counts] = await Promise.all([this.suppliers.list(query, owed), this.suppliers.countActive()]);
		const items = await Promise.all(
			page.items.map(async (supplier) => {
				const posted = (await this.entries.forSupplier(supplier.id)).filter(
					(entry) => entry.status === 'posted',
				);
				const last = posted.reduce<string | null>(
					(latest, entry) => (!latest || entry.billDate > latest ? entry.billDate : latest),
					null,
				);
				return {
					...supplier,
					owedINR: Math.max(0, owed.get(supplier.id) ?? 0),
					purchaseCount: posted.length,
					lastPurchaseOn: last,
				};
			}),
		);
		return {
			items,
			total: page.total,
			counts: {
				all: counts.all,
				owed: [...owed.values()].filter((value) => value > 0).length,
				inactive: counts.inactive,
			},
		};
	}

	async get(id: string): Promise<Supplier> {
		const supplier = await this.suppliers.findById(id);
		if (!supplier) throw missing('Supplier');
		return supplier;
	}

	/** The supplier page (s03): tiles and the statement. */
	async summary(id: string): Promise<SupplierSummary> {
		const supplier = await this.get(id);
		const [entries, payments, returns] = await Promise.all([
			this.entries.forSupplier(id),
			this.payments.forSupplier(id),
			this.returns.forSupplier(id),
		]);
		const today = this.support.today();
		const yearStart = fiscalYearStart(fiscalYearOf(today));
		const posted = entries.filter((entry) => entry.status === 'posted');
		const open = posted.filter((entry) => entryOutstanding(entry) > 0.005);
		const oldest = open.reduce<string | null>(
			(first, entry) => (!first || entry.billDate < first ? entry.billDate : first),
			null,
		);
		const sentThisYear = returns.filter((doc) => doc.sentAt && doc.sentAt.slice(0, 10) >= yearStart);
		const thisYear = posted.filter((entry) => entry.billDate >= yearStart);
		return {
			supplier,
			owedINR: Math.round(posted.reduce((sum, entry) => sum + entryOutstanding(entry), 0) * 100) / 100,
			owedBills: open.length,
			nextDueOn: open.reduce<string | null>(
				(next, entry) => (!next || entry.dueOn < next ? entry.dueOn : next),
				null,
			),
			boughtThisYearINR: Math.round(thisYear.reduce((sum, entry) => sum + entry.totals.totalINR, 0) * 100) / 100,
			entriesThisYear: thisYear.length,
			returnedThisYearINR: Math.round(sentThisYear.reduce((sum, doc) => sum + doc.totalINR, 0) * 100) / 100,
			debitNotesThisYear: sentThisYear.length,
			oldestUnpaidDays: oldest ? Math.max(0, daysBetween(oldest, today)) : null,
			statement: supplierStatement({ entries, payments, returns }),
		};
	}

	/** s02/s02b: format, State, check digit, and other suppliers with the same GSTIN or PAN. */
	async checkGstin(gstin: string, excludeId: string | null): Promise<SupplierGstinCheck> {
		const value = gstin.trim().toUpperCase();
		const problem = gstinProblem(value);
		if (problem) {
			return {
				problem: problem.problem,
				expectedLastCharacter: problem.expected ?? null,
				stateCode: null,
				pan: null,
				taxType: null,
				sameGstin: null,
				samePan: [],
			};
		}
		const stateCode = value.slice(0, 2);
		const pan = panFromGstin(value);
		const [same, panMatches] = await Promise.all([
			this.suppliers.findByGstin(value),
			this.suppliers.findByPan(pan),
		]);
		return {
			problem: null,
			expectedLastCharacter: null,
			stateCode,
			pan,
			taxType: purchaseTaxType('regular', stateCode, await this.support.homeState()),
			sameGstin: same && same.id !== excludeId ? { id: same.id, name: same.legalName } : null,
			samePan: panMatches
				.filter((row) => row.id !== excludeId && row.gstin !== value && row.gstin)
				.map((row) => ({ id: row.id, name: row.legalName, gstin: row.gstin ?? '' })),
		};
	}

	private async refuseDuplicateGstin(body: SupplierWrite, excludeId: string | null): Promise<void> {
		if (!body.gstin) return;
		const same = await this.suppliers.findByGstin(body.gstin);
		if (same && same.id !== excludeId) {
			throw refuse('gstin_taken', `${same.legalName} already has GSTIN ${body.gstin}.`, same.id);
		}
	}

	private build(id: string, body: SupplierWrite, previous: Supplier | null, homeState: string): Supplier {
		const now = new Date().toISOString();
		// A registered supplier's State and PAN always come from the GSTIN (locked on the form).
		const stateCode = body.gstin ? body.gstin.slice(0, 2) : body.stateCode;
		return {
			id,
			legalName: body.legalName,
			shortName: body.shortName,
			kind: body.kind,
			gstin: body.kind === 'unregistered' ? null : body.gstin,
			pan: body.gstin ? panFromGstin(body.gstin) : body.pan,
			stateCode,
			stateName: gstStateName(stateCode) ?? stateCode,
			address: body.address,
			contactName: body.contactName,
			phone: body.phone,
			email: body.email,
			paymentTermsDays: body.paymentTermsDays,
			usesItemCodes: body.usesItemCodes,
			notes: body.notes,
			active: body.active,
			taxType: purchaseTaxType(body.kind, stateCode, homeState),
			createdAt: previous?.createdAt ?? now,
			updatedAt: now,
		};
	}

	async create(body: SupplierWrite, actor: string | null): Promise<Supplier> {
		await this.refuseDuplicateGstin(body, null);
		const supplier = this.build(`sup_${randomUUID()}`, body, null, await this.support.homeState());
		await this.suppliers.save(supplier);
		await this.support.record({
			actor,
			action: 'purchase.supplier.create',
			entityType: 'supplier',
			entityId: supplier.id,
			text: `${await this.support.nameOf(actor)} added supplier ${supplier.legalName}${supplier.gstin ? ` (GSTIN ${supplier.gstin}, ${gstStateName(supplier.stateCode) ?? supplier.stateCode})` : ` (${supplier.kind})`}, payment terms ${supplier.paymentTermsDays} days.`,
		});
		return supplier;
	}

	async update(id: string, body: SupplierWrite, actor: string | null): Promise<Supplier> {
		const previous = await this.get(id);
		await this.refuseDuplicateGstin(body, id);
		const next = this.build(id, body, previous, await this.support.homeState());
		// Bills already posted keep the tax they were entered with; only new bills change.
		await this.suppliers.save(next);
		const changed = (['legalName', 'kind', 'gstin', 'stateCode', 'paymentTermsDays', 'active'] as const)
			.filter((key) => previous[key] !== next[key])
			.map((key) => `${key} ${String(previous[key])} → ${String(next[key])}`);
		await this.support.record({
			actor,
			action: 'purchase.supplier.update',
			entityType: 'supplier',
			entityId: id,
			text: `${await this.support.nameOf(actor)} changed supplier ${next.legalName}${changed.length ? `: ${changed.join('; ')}` : '.'}`,
		});
		return next;
	}

	/** Soft delete, refused while any purchase entry or order names the supplier (s01). */
	async remove(id: string, actor: string | null): Promise<void> {
		const supplier = await this.get(id);
		if (await this.suppliers.hasDocuments(id)) {
			throw refuse(
				'supplier_has_documents',
				`${supplier.legalName} has purchase entries or orders, so it stays for the books. Mark it inactive instead.`,
			);
		}
		await this.suppliers.softDelete(id, actor, new Date().toISOString());
		await this.support.record({
			actor,
			action: 'purchase.supplier.delete',
			entityType: 'supplier',
			entityId: id,
			text: `${await this.support.nameOf(actor)} deleted supplier ${supplier.legalName}.`,
		});
	}

	async activity(id: string) {
		await this.get(id);
		return this.support.activity('supplier', [id]);
	}

	/** Remembers one of the supplier's own item codes for a variant ("their item codes", s02). */
	async rememberCode(id: string, code: string, variantId: string): Promise<void> {
		await this.get(id);
		await this.itemCodes.remember(id, code, variantId);
	}
}
