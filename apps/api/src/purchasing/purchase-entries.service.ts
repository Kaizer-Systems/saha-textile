import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
	PurchaseEntry,
	PurchaseEntryListQuery,
	PurchaseEntryListResponse,
	PurchaseEntryWrite,
	PurchaseGoodsCheck,
	PurchasePost,
	PurchaseReturn,
	PurchaseVoid,
	PurchaseWarning,
	SupplierPayment,
	SupplierPaymentWrite,
} from '@saha-textile/contracts';
import {
	type EntryMathResult,
	type InventoryCostLayerRepository,
	type NumberAllocatorPort,
	type ProductRepository,
	type PurchaseEntryRepository,
	type PurchaseOrderRepository,
	type PurchaseReturnRepository,
	type SearchOutboxRepository,
	StaleVersionError,
	type StockMovementPort,
	StockMovementRefusedError,
	type StockReadRepository,
	type SupplierItemCodeRepository,
	type SupplierPaymentRepository,
	addDays,
	booksClosedProblem,
	computeReturnTotals,
	describeUnits,
	entryOutstanding,
	entryPaymentStatus,
	fiscalYearOf,
	formatDocumentNumber,
	formatQuantity,
	formatRupees,
	goodsCheckProblems,
	normalizeBillNumber,
	purchaseOrderStatusOf,
	samePersonProblem,
	voidBlockers,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	INVENTORY_COST_LAYER_REPOSITORY,
	NUMBER_ALLOCATOR,
	PRODUCT_REPOSITORY,
	PURCHASE_ENTRY_REPOSITORY,
	PURCHASE_ORDER_REPOSITORY,
	PURCHASE_RETURN_REPOSITORY,
	SEARCH_OUTBOX,
	STOCK_MOVEMENT,
	STOCK_READ_REPOSITORY,
	SUPPLIER_ITEM_CODE_REPOSITORY,
	SUPPLIER_PAYMENT_REPOSITORY,
} from '../infra/tokens';
import { PurchaseEntryBuilder, warningKey } from './purchase-entry-builder';
import { PurchasingSupport, actorOf, canSeeCost, missing, refuse, refuseAll } from './purchasing-support';

/** Mongo's duplicate-key code: the unique index on supplier + bill number caught a race. */
const isDuplicateKey = (error: unknown): boolean =>
	typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** The cost a stock unit carries, from the line arithmetic (per piece, or per tenth of a metre). */
const perStockUnit = (math: EntryMathResult, lineId: string): number =>
	math.lines.find((line) => line.lineId === lineId)?.unitCostPerStockUnitINR ?? 0;

/** Margin figures say how much profit there is, so they go only to people who see cost (P8). */
function redactWarning(warning: PurchaseWarning): PurchaseWarning {
	if (warning.code !== 'margin_floor') return warning;
	return { ...warning, detail: 'Margin is under your floor.', values: {} };
}

export function entryView(entry: PurchaseEntry, seeCost: boolean): PurchaseEntry {
	if (seeCost) return entry;
	return {
		...entry,
		lines: entry.lines.map((line) => ({ ...line, unitCostINR: null, marginPct: null })),
		totals: { ...entry.totals, costIntoStockINR: null },
		warnings: entry.warnings.map(redactWarning),
		acceptedWarnings: entry.acceptedWarnings.map(redactWarning),
	};
}

/**
 * Purchase entries: a supplier's bill from typing to stock (p01–p13). Nothing touches stock until
 * Posted; posting writes stock, FIFO cost layers, the payable, order receipts, return drafts and
 * the audit sentence in one transaction (brief: automation, posting).
 */
@Injectable()
export class PurchaseEntriesService {
	constructor(
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: PurchaseEntryRepository,
		@Inject(PURCHASE_ORDER_REPOSITORY) private readonly orders: PurchaseOrderRepository,
		@Inject(PURCHASE_RETURN_REPOSITORY) private readonly returns: PurchaseReturnRepository,
		@Inject(SUPPLIER_PAYMENT_REPOSITORY) private readonly payments: SupplierPaymentRepository,
		@Inject(SUPPLIER_ITEM_CODE_REPOSITORY) private readonly itemCodes: SupplierItemCodeRepository,
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: StockReadRepository,
		@Inject(STOCK_MOVEMENT) private readonly movement: StockMovementPort,
		@Inject(INVENTORY_COST_LAYER_REPOSITORY) private readonly layers: InventoryCostLayerRepository,
		@Inject(NUMBER_ALLOCATOR) private readonly numbers: NumberAllocatorPort,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		private readonly builder: PurchaseEntryBuilder,
		private readonly support: PurchasingSupport,
		@Optional() @Inject(SEARCH_OUTBOX) private readonly searchOutbox: SearchOutboxRepository | null = null,
	) {}

	private async load(id: string): Promise<PurchaseEntry> {
		const entry = await this.entries.findById(id);
		if (!entry) throw missing('Purchase entry');
		return entry;
	}

	async get(id: string, principal: AuthenticatedPrincipal | undefined): Promise<PurchaseEntry> {
		return entryView(await this.load(id), canSeeCost(principal));
	}

	private async stale(entry: PurchaseEntry, version: number | undefined): Promise<void> {
		if (version === undefined || version === entry.version) return;
		throw await this.support.staleConflict(
			new StaleVersionError('purchase_entry', entry.id, {
				version: entry.version,
				updatedAt: entry.updatedAt,
				updatedBy: entry.updatedBy ?? null,
			}),
		);
	}

	/** P07: one supplier, one bill number, however it is typed; the second is refused with a link. */
	private async refuseDuplicate(entry: PurchaseEntry): Promise<void> {
		const same = await this.entries.findByBill(entry.supplierId, normalizeBillNumber(entry.billNumber), entry.id);
		if (same) {
			throw refuse(
				'duplicate_bill',
				`${entry.supplierName} bill ${same.billNumber} is already entered${same.number ? ` as ${same.number}` : ' as a draft'}.`,
				same.id,
			);
		}
	}

	private async saveVersioned(entry: PurchaseEntry, expected: number | null): Promise<PurchaseEntry> {
		try {
			const version = await this.support.guardStale(() => this.entries.save(entry, expected));
			return { ...entry, version };
		} catch (error) {
			if (isDuplicateKey(error)) await this.refuseDuplicate(entry);
			throw error;
		}
	}

	async create(write: PurchaseEntryWrite, principal: AuthenticatedPrincipal | undefined): Promise<PurchaseEntry> {
		const actor = actorOf(principal);
		// An empty draft is fine: the header is often typed before the parcel is opened.
		const { entry } = await this.builder.build(write, null, actor);
		await this.refuseDuplicate(entry);
		const saved = await this.saveVersioned({ ...entry, status: 'draft' }, null);
		await this.support.record({
			actor,
			action: 'purchase.entry.create',
			entityType: 'purchase_entry',
			entityId: saved.id,
			text: `${await this.support.nameOf(actor)} made a draft for ${saved.supplierName}, bill ${saved.billNumber}${saved.lines.length ? `: ${saved.lines.length} lines, ${describeUnits(saved.lines.map((line) => ({ units: line.quantity, soldBy: line.soldBy })))}` : ''}.`,
		});
		return entryView(saved, canSeeCost(principal));
	}

	async update(
		id: string,
		write: PurchaseEntryWrite,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<PurchaseEntry> {
		const actor = actorOf(principal);
		const existing = await this.load(id);
		if (existing.status !== 'draft' && existing.status !== 'checked') {
			throw refuse(
				'wrong_status',
				'A posted or voided entry is locked: fix it with a purchase return or an adjustment.',
			);
		}
		await this.stale(existing, write.version);
		const { entry } = await this.builder.build(write, existing, actor);
		// A changed item or quantity undoes the goods check: the parcel must be counted again.
		const checkStands = entry.lines.every((line) => line.accepted !== null) && entry.lines.length > 0;
		const next: PurchaseEntry =
			existing.status === 'checked' && !checkStands
				? { ...entry, status: 'draft', checkedBy: null, checkedAt: null }
				: entry;
		await this.refuseDuplicate(next);
		const saved = await this.saveVersioned(next, existing.version);
		const linesChanged =
			JSON.stringify(existing.lines.map((line) => [line.variantId, line.quantity, line.unitPriceINR])) !==
			JSON.stringify(saved.lines.map((line) => [line.variantId, line.quantity, line.unitPriceINR]));
		await this.support.record({
			actor,
			action: 'purchase.entry.update',
			entityType: 'purchase_entry',
			entityId: id,
			text: linesChanged
				? `${await this.support.nameOf(actor)} changed the lines: ${saved.lines.length} lines, ${describeUnits(saved.lines.map((line) => ({ units: line.quantity, soldBy: line.soldBy })))}${saved.freightINR ? `. Freight ${formatRupees(saved.freightINR)} shared by value` : ''}.${existing.status === 'checked' && saved.status === 'draft' ? ' The goods check must be done again.' : ''}`
				: `${await this.support.nameOf(actor)} changed the bill details.`,
		});
		return entryView(saved, canSeeCost(principal));
	}

	async remove(id: string, actor: string | null): Promise<void> {
		const entry = await this.load(id);
		if (entry.status !== 'draft' && entry.status !== 'checked') {
			throw refuse('wrong_status', 'Only a draft can be deleted. A posted entry is voided instead.');
		}
		await this.entries.remove(id);
		await this.support.record({
			actor,
			action: 'purchase.entry.delete',
			entityType: 'purchase_entry',
			entityId: id,
			text: `${await this.support.nameOf(actor)} deleted the draft for ${entry.supplierName}, bill ${entry.billNumber}.`,
		});
	}

	/** p08/g01: good + damaged + missing per line; the bill total must match first. */
	async checkGoods(id: string, body: PurchaseGoodsCheck, principal: AuthenticatedPrincipal | undefined) {
		const actor = actorOf(principal);
		const entry = await this.load(id);
		if (entry.status !== 'draft' && entry.status !== 'checked') {
			throw refuse('wrong_status', 'This entry is already posted.');
		}
		await this.stale(entry, body.version);
		if (entry.lines.length === 0) throw refuse('no_lines', 'Add the bill lines before checking the goods.');
		if (entry.totals.printedTotalINR === null) {
			throw refuse('printed_total_missing', 'Type the bill total as printed first.', 'printedTotalINR');
		}
		if (!entry.totals.matchesPrinted) {
			throw refuse(
				'total_mismatch',
				`The lines come to ${formatRupees(entry.totals.totalINR)}; the bill says ${formatRupees(entry.totals.printedTotalINR)} (${formatRupees(Math.abs(entry.totals.differenceINR))} apart).`,
				'printedTotalINR',
			);
		}
		const settings = await this.support.settings();
		const person = samePersonProblem({
			required: settings.stepRules.checkByDifferentPerson,
			actorId: actor,
			previousActorId: entry.createdBy,
			step: 'check',
		});
		if (person) throw refuse(person.code, person.detail);
		const problems = goodsCheckProblems(
			entry.lines.map((line) => ({ lineId: line.lineId, quantity: line.quantity })),
			body.lines,
		);
		if (problems.length) throw refuseAll(problems);

		const byLine = new Map(body.lines.map((row) => [row.lineId, row]));
		const lines = entry.lines.map((line) => {
			const row = byLine.get(line.lineId);
			if (!row) return line;
			return {
				...line,
				accepted: row.accepted,
				damaged: row.damaged,
				missing: row.missing,
				damageReason: row.damaged > 0 ? row.damageReason : null,
				damageNote: row.damaged > 0 ? row.damageNote : null,
				damagePhotoAssetIds: row.damaged > 0 ? row.damagePhotoAssetIds : [],
			};
		});
		const now = new Date().toISOString();
		const saved = await this.saveVersioned(
			{ ...entry, lines, status: 'checked', checkedBy: actor, checkedAt: now, updatedAt: now, updatedBy: actor },
			entry.version,
		);
		const units = (pick: (line: (typeof lines)[number]) => number) =>
			describeUnits(lines.map((line) => ({ units: pick(line), soldBy: line.soldBy })));
		const problemsText = lines
			.filter((line) => line.damaged > 0 || line.missing > 0)
			.map((line) =>
				[
					line.damaged > 0
						? `${formatQuantity(line.damaged, line.soldBy)} damaged (${line.sku}${line.damageNote ? `, "${line.damageNote}"` : ''}${line.damagePhotoAssetIds.length ? `, ${line.damagePhotoAssetIds.length} photo${line.damagePhotoAssetIds.length === 1 ? '' : 's'}` : ''})`
						: '',
					line.missing > 0 ? `${formatQuantity(line.missing, line.soldBy)} missing (${line.sku})` : '',
				]
					.filter(Boolean)
					.join(', '),
			)
			.join(', ');
		await this.support.record({
			actor,
			action: 'purchase.entry.goods_check',
			entityType: 'purchase_entry',
			entityId: id,
			text: `${await this.support.nameOf(actor)} checked goods on the draft for ${entry.supplierName} ${entry.billNumber}: ${units((line) => line.accepted ?? 0)} good${problemsText ? `, ${problemsText}` : ', none damaged, none missing'}.`,
		});
		return entryView(saved, canSeeCost(principal));
	}

	/** p09: exactly what posting will change, before it does. */
	async postPreview(id: string, principal: AuthenticatedPrincipal | undefined) {
		const entry = await this.load(id);
		const built = await this.builder.build(PurchaseEntryBuilder.writeOf(entry), entry, actorOf(principal));
		const settings = built.settings;
		const fiscalYear = fiscalYearOf(this.support.today());
		const next = await this.numbers.peek('PE', fiscalYear);
		const accepted = entry.lines.filter((line) => (line.accepted ?? 0) > 0);
		const cost = accepted.reduce(
			(sum, line) => sum + Math.round(perStockUnit(built.math, line.lineId) * (line.accepted ?? 0) * 100),
			0,
		);
		return {
			numberPreview: formatDocumentNumber(settings.numberFormats.purchaseEntry, fiscalYear, next),
			intoStock: describeUnits(entry.lines.map((line) => ({ units: line.accepted ?? 0, soldBy: line.soldBy }))),
			skus: new Set(accepted.map((line) => line.variantId)).size,
			damaged: describeUnits(entry.lines.map((line) => ({ units: line.damaged, soldBy: line.soldBy }))),
			missing: describeUnits(entry.lines.map((line) => ({ units: line.missing, soldBy: line.soldBy }))),
			hasDamaged: entry.lines.some((line) => line.damaged > 0),
			hasMissing: entry.lines.some((line) => line.missing > 0),
			costIntoStockINR: canSeeCost(principal) ? cost / 100 : null,
			itcClaimable: entry.itcClaimable,
			dueOn: entry.dueOn,
			paymentTermsDays: Math.max(
				0,
				Math.round((Date.parse(entry.dueOn) - Date.parse(entry.billDate)) / 86_400_000),
			),
			warnings: canSeeCost(principal) ? built.entry.warnings : built.entry.warnings.map(redactWarning),
			totalINR: entry.totals.totalINR,
		};
	}

	/** Damaged pieces go back to the supplier, missing ones become a claim (p08): both as drafts. */
	private goodsCheckDrafts(
		entry: PurchaseEntry,
		math: EntryMathResult,
		number: string,
		actor: string | null,
	): PurchaseReturn[] {
		const now = new Date().toISOString();
		const draft = (
			kind: 'return_goods' | 'short_supply',
			reason: PurchaseReturn['reason'],
			picks: Array<{ line: PurchaseEntry['lines'][number]; quantity: number }>,
		): PurchaseReturn => {
			const totals = computeReturnTotals(
				entry.taxType,
				picks.map(({ line, quantity }) => ({
					quantity,
					unitCostPerStockUnitINR: perStockUnit(math, line.lineId),
					gstRatePct: line.gstRatePct,
				})),
			);
			return {
				id: `pr_${randomUUID()}`,
				number: null,
				kind,
				status: 'draft',
				origin: 'goods_check',
				purchaseEntryId: entry.id,
				purchaseEntryNumber: number,
				supplierId: entry.supplierId,
				supplierName: entry.supplierName,
				taxType: entry.taxType,
				reason,
				noteToSupplier:
					picks
						.map(({ line }) => line.damageNote)
						.filter(Boolean)
						.join('; ') || null,
				photoAssetIds: picks.flatMap(({ line }) => line.damagePhotoAssetIds),
				lines: picks.map(({ line, quantity }, index) => ({
					lineId: `prl_${randomUUID()}`,
					entryLineId: line.lineId,
					productId: line.productId,
					variantId: line.variantId,
					sku: line.sku,
					title: line.title,
					optionsLabel: line.optionsLabel,
					soldBy: line.soldBy,
					imageUrl: line.imageUrl,
					quantity,
					unitCostINR: perStockUnit(math, line.lineId),
					gstRatePct: line.gstRatePct,
					taxableINR: totals.lines[index]?.taxableINR ?? 0,
					taxINR: totals.lines[index]?.taxINR ?? 0,
					totalINR: totals.lines[index]?.totalINR ?? 0,
				})),
				taxableINR: totals.taxableINR,
				cgstINR: totals.cgstINR,
				sgstINR: totals.sgstINR,
				igstINR: totals.igstINR,
				totalINR: totals.totalINR,
				challanNumber: null,
				courier: null,
				docket: null,
				sentAt: null,
				sentBy: null,
				settlements: [],
				settledINR: 0,
				settledAt: null,
				settledBy: null,
				holdId: null,
				createdBy: actor,
				createdAt: now,
				updatedAt: now,
				updatedBy: actor,
				version: 1,
			};
		};
		const drafts: PurchaseReturn[] = [];
		const damaged = entry.lines.filter((line) => line.damaged > 0);
		// One draft per reason the goods check gave, so the debit note says why.
		for (const reason of ['damaged_on_arrival', 'wrong_item', 'other'] as const) {
			const picks = damaged
				.filter((line) => (line.damageReason ?? 'other') === reason)
				.map((line) => ({ line, quantity: line.damaged }));
			if (picks.length) drafts.push(draft('return_goods', reason, picks));
		}
		const missingLines = entry.lines
			.filter((line) => line.missing > 0)
			.map((line) => ({ line, quantity: line.missing }));
		if (missingLines.length) drafts.push(draft('short_supply', 'short_supplied', missingLines));
		return drafts;
	}

	/**
	 * p09/x03: posts the checked entry. Idempotent per request key: pressing again after a dropped
	 * line returns the posted entry instead of posting twice.
	 */
	async post(id: string, body: PurchasePost, principal: AuthenticatedPrincipal | undefined) {
		const actor = actorOf(principal);
		const entry = await this.load(id);
		const claimedKey = (entry as PurchaseEntry & { postRequestKey?: string | null }).postRequestKey ?? null;
		if (entry.status === 'posted' && claimedKey === body.requestKey) return entryView(entry, canSeeCost(principal));
		if (entry.status !== 'checked') {
			throw refuse(
				'wrong_status',
				entry.status === 'draft' ? 'Check the goods before posting.' : 'This entry is already posted.',
			);
		}
		await this.stale(entry, body.version);
		const built = await this.builder.build(PurchaseEntryBuilder.writeOf(entry), entry, actor);
		const settings = built.settings;
		const person = samePersonProblem({
			required: settings.stepRules.postByDifferentPerson,
			actorId: actor,
			previousActorId: entry.checkedBy,
			step: 'post',
		});
		if (person) throw refuse(person.code, person.detail);
		// Warnings never block, but posting needs whoever posts to have seen every current one.
		const accepted = new Set(body.acceptWarningCodes);
		const unseen = built.entry.warnings.filter((warning) => !accepted.has(warningKey(warning)));
		if (unseen.length) {
			throw refuseAll(
				unseen.map((warning) => ({
					code: 'warnings_changed',
					detail: canSeeCost(principal) ? warning.detail : redactWarning(warning).detail,
					lineId: warning.lineId,
				})),
			);
		}
		// The rebuilt lines carry today's prices and warnings and keep the goods check (nothing changed).
		const lines = built.entry.lines;
		if (lines.some((line) => line.accepted === null))
			throw refuse('goods_check_missing_line', 'Every line must be counted.');

		// Products that had nothing to sell before: their back-in-stock badge starts (14-day rule).
		const productIds = [...new Set(lines.map((line) => line.productId))];
		const freeBefore = new Map<string, number>();
		for (const productId of productIds) {
			const variants = await this.stock.variantsOfProduct(productId);
			freeBefore.set(
				productId,
				variants.reduce((sum, row) => sum + Math.max(0, row.onHand - row.held), 0),
			);
		}

		const today = this.support.today();
		const fiscalYear = fiscalYearOf(today);
		const now = new Date().toISOString();
		const receivedAt =
			entry.goodsReceivedOn === today ? now : new Date(`${entry.goodsReceivedOn}T12:00:00+05:30`).toISOString();

		const posted = await this.support
			.inTransaction(async (context) => {
				if ((await this.entries.claimRequestKey(body.requestKey, entry.id, context)) === 'seen') {
					throw refuse('post_in_progress', 'This entry is being posted already. Reload in a moment.');
				}
				const sequence = await this.numbers.next('PE', fiscalYear, context);
				const number = formatDocumentNumber(settings.numberFormats.purchaseEntry, fiscalYear, sequence);
				const postedLines: PurchaseEntry['lines'] = [];
				for (const line of lines) {
					const units = line.accepted ?? 0;
					let costLayerId: string | null = null;
					if (units > 0) {
						costLayerId = `lay_${randomUUID()}`;
						await this.layers.createLayer(
							{
								id: costLayerId,
								variantId: line.variantId,
								purchaseInvoiceId: entry.id,
								sourceType: 'purchase_invoice',
								sourceLineId: line.lineId,
								sourceNumber: number,
								unitCostINR: perStockUnit(built.math, line.lineId),
								quantityReceived: units,
								quantityRemaining: units,
								receivedAt,
							},
							context,
						);
						await this.movement.move(
							{
								variantId: line.variantId,
								productId: line.productId,
								quantityDelta: units,
								heldDelta: 0,
								source: 'purchase_invoice',
								reasonCode: null,
								note: null,
								referenceType: 'purchase_entry',
								referenceId: entry.id,
								referenceNumber: number,
								actorUserId: actor,
								approverUserId: null,
								at: now,
							},
							context,
						);
					}
					if (line.supplierItemCode)
						await this.itemCodes.remember(entry.supplierId, line.supplierItemCode, line.variantId, context);
					postedLines.push({ ...line, costLayerId });
				}

				if (built.order) {
					const order = built.order;
					const arrived = new Map<string, number>();
					for (const line of postedLines) {
						if (line.purchaseOrderLineId)
							arrived.set(
								line.purchaseOrderLineId,
								(arrived.get(line.purchaseOrderLineId) ?? 0) + line.quantity,
							);
					}
					const orderLines = order.lines.map((line) => {
						const quantity = arrived.get(line.lineId) ?? 0;
						return quantity
							? {
									...line,
									receivedQuantity: line.receivedQuantity + quantity,
									receivedOn: [...(line.receivedOn ?? []), { entryId: entry.id, number, quantity }],
								}
							: line;
					});
					const status = purchaseOrderStatusOf({ current: order.status, lines: orderLines });
					await this.orders.save(
						{
							...order,
							lines: orderLines,
							status,
							linkedEntryIds: [...new Set([...order.linkedEntryIds, entry.id])],
							late: false,
							updatedAt: now,
							updatedBy: actor,
						},
						order.version,
						context,
					);
				}

				const drafts = this.goodsCheckDrafts({ ...entry, lines: postedLines }, built.math, number, actor);
				for (const draft of drafts) await this.returns.save(draft, null, context);

				const next: PurchaseEntry = {
					...built.entry,
					lines: postedLines,
					status: 'posted',
					number,
					paymentStatus: 'unpaid',
					paidINR: 0,
					creditedINR: 0,
					acceptedWarnings: built.entry.warnings,
					checkedBy: entry.checkedBy,
					checkedAt: entry.checkedAt,
					postedBy: actor,
					postedAt: now,
					returnDraftIds: drafts.map((draft) => draft.id),
					updatedAt: now,
					updatedBy: actor,
				};
				const version = await this.entries.save(next, entry.version, context);

				const intoStock = describeUnits(
					postedLines.map((line) => ({ units: line.accepted ?? 0, soldBy: line.soldBy })),
				);
				const skus = new Set(
					postedLines.filter((line) => (line.accepted ?? 0) > 0).map((line) => line.variantId),
				).size;
				const accepted = next.acceptedWarnings;
				const tax =
					entry.taxType === 'inter_state'
						? `IGST ${formatRupees(next.totals.igstINR)}`
						: entry.taxType === 'intra_state'
							? `CGST ${formatRupees(next.totals.cgstINR)}, SGST ${formatRupees(next.totals.sgstINR)}`
							: 'no GST (no input credit)';
				await this.support.record(
					{
						actor,
						action: 'purchase.entry.post',
						entityType: 'purchase_entry',
						entityId: entry.id,
						text: `${await this.support.nameOf(actor)} posted ${number} from ${entry.supplierName} (bill ${entry.billNumber}): ${intoStock} across ${skus} SKU${skus === 1 ? '' : 's'}, cost ${formatRupees(next.totals.costIntoStockINR ?? 0)}, ${tax}.${accepted.length ? ` Accepted ${accepted.length} warning${accepted.length === 1 ? '' : 's'}: ${accepted.map((warning) => `${warning.lineId ? `${postedLines.find((line) => line.lineId === warning.lineId)?.sku ?? ''} ` : ''}${warning.detail}`).join('; ')}` : ''}${drafts.length ? ` Made ${drafts.length} return draft${drafts.length === 1 ? '' : 's'} for the supplier.` : ''}`,
						facts: { number, units: intoStock, skus },
					},
					context,
				);
				return { ...next, version };
			})
			.catch(async (error: unknown) => {
				if (error instanceof StockMovementRefusedError) {
					throw refuse('stock_moved_meanwhile', 'Stock changed while posting. Reload and post again.');
				}
				if (isDuplicateKey(error))
					throw refuse('post_in_progress', 'This entry is being posted already. Reload in a moment.');
				throw error;
			});

		await this.afterStockIn(productIds, freeBefore, lines);
		return entryView(posted, canSeeCost(principal));
	}

	/** Back-in-stock dates and lifetime received units, then the shop's search entries. */
	private async afterStockIn(
		productIds: readonly string[],
		freeBefore: ReadonlyMap<string, number>,
		lines: ReadonlyArray<{ productId: string; accepted: number | null }>,
	): Promise<void> {
		const now = new Date().toISOString();
		for (const productId of productIds) {
			const product = await this.products.findById(productId, 'admin');
			if (!product) continue;
			const received = lines
				.filter((line) => line.productId === productId)
				.reduce((sum, line) => sum + (line.accepted ?? 0), 0);
			const variants = await this.stock.variantsOfProduct(productId);
			const freeAfter = variants.reduce((sum, row) => sum + Math.max(0, row.onHand - row.held), 0);
			const cameBack =
				(freeBefore.get(productId) ?? 0) === 0 && freeAfter > 0 && product.lifetimeUnitsReceived > 0;
			await this.products.save({
				...product,
				lifetimeUnitsReceived: product.lifetimeUnitsReceived + received,
				backInStockAt: cameBack ? now : product.backInStockAt,
			});
		}
		await this.searchOutbox?.request(productIds, new Date()).catch(() => undefined);
	}

	/** p12: void only while every piece is still on the shelf, untouched, and nothing is paid or sent back. */
	async void(id: string, body: PurchaseVoid, actor: string | null) {
		const entry = await this.load(id);
		if (entry.status !== 'posted')
			throw refuse('wrong_status', 'Only a posted entry can be voided; a draft is deleted.');
		const settings = await this.support.settings();
		const closed = booksClosedProblem([entry.billDate], settings.booksClosedUpTo);
		if (closed) throw refuse(closed.code, `${closed.detail} Voiding would change closed books.`);
		const [layerRows, returns, payments] = await Promise.all([
			this.stock.layersForEntry(id),
			this.returns.forEntry(id),
			this.payments.forEntry(id),
		]);
		const goneBack = new Map<string, number>();
		for (const doc of returns) {
			if (doc.status === 'draft' || doc.kind !== 'return_goods' || doc.origin === 'goods_check') continue;
			for (const line of doc.lines)
				goneBack.set(line.entryLineId, (goneBack.get(line.entryLineId) ?? 0) + line.quantity);
		}
		const lineBy = new Map(entry.lines.map((line) => [line.lineId, line]));
		const verdict = voidBlockers({
			status: entry.status,
			layers: layerRows.map((layer) => {
				const returned = goneBack.get(layer.sourceLineId ?? '') ?? 0;
				return {
					sku: lineBy.get(layer.sourceLineId ?? '')?.sku ?? layer.variantId,
					received: layer.quantityReceived,
					remaining: layer.quantityRemaining,
					returned,
					sold: Math.max(0, layer.quantityReceived - layer.quantityRemaining - returned),
					documents: [],
				};
			}),
			reservedBySku: {},
			activePayments: payments.filter((payment) => !payment.reversedAt).length,
			sentReturns: returns.filter((doc) => doc.status !== 'draft').length,
		});
		if (verdict.blocked) {
			if (verdict.reason === 'stock_moved' && verdict.lines.length) {
				throw refuseAll(
					verdict.lines.map((line) => ({
						code: 'void_stock_moved',
						lineId: line.sku,
						detail: [
							line.soldUnits ? `sold ${line.soldUnits}` : '',
							line.reservedUnits ? `in a paid checkout ${line.reservedUnits}` : '',
							line.returnedUnits ? `returned ${line.returnedUnits}` : '',
						]
							.filter(Boolean)
							.join(', '),
					})),
				);
			}
			const reasons: Record<string, string> = {
				stock_moved: 'Some of its pieces have left stock, so taking them back out would leave the shop short.',
				returns: 'A return from it has been sent to the supplier.',
				payments: 'Payments are recorded against it: reverse them first.',
				wrong_status: 'Only a posted entry can be voided.',
			};
			throw refuse(
				`void_${verdict.reason ?? 'blocked'}`,
				reasons[verdict.reason ?? ''] ?? 'This entry cannot be voided.',
			);
		}

		const now = new Date().toISOString();
		const voided = await this.support
			.inTransaction(async (context) => {
				for (const layer of layerRows) {
					if (layer.quantityRemaining <= 0) continue;
					const line = lineBy.get(layer.sourceLineId ?? '');
					await this.movement.consumeLayer(layer.id, layer.quantityRemaining, context);
					await this.movement.move(
						{
							variantId: layer.variantId,
							productId: line?.productId ?? '',
							quantityDelta: -layer.quantityRemaining,
							heldDelta: 0,
							source: 'purchase_invoice',
							reasonCode: null,
							note: `Void: ${body.reason}`,
							referenceType: 'purchase_entry',
							referenceId: entry.id,
							referenceNumber: entry.number,
							actorUserId: actor,
							approverUserId: null,
							at: now,
						},
						context,
					);
				}
				if (entry.purchaseOrderId) {
					const order = await this.orders.findById(entry.purchaseOrderId, context);
					if (order) {
						const took = new Map<string, number>();
						for (const line of entry.lines) {
							if (line.purchaseOrderLineId)
								took.set(
									line.purchaseOrderLineId,
									(took.get(line.purchaseOrderLineId) ?? 0) + line.quantity,
								);
						}
						const orderLines = order.lines.map((line) => ({
							...line,
							receivedQuantity: Math.max(0, line.receivedQuantity - (took.get(line.lineId) ?? 0)),
							receivedOn: (line.receivedOn ?? []).filter((row) => row.entryId !== entry.id),
						}));
						const reopened =
							order.status === 'received' || order.status === 'part_received' ? 'sent' : order.status;
						await this.orders.save(
							{
								...order,
								lines: orderLines,
								status: purchaseOrderStatusOf({ current: reopened, lines: orderLines }),
								linkedEntryIds: order.linkedEntryIds.filter((entryId) => entryId !== entry.id),
								updatedAt: now,
								updatedBy: actor,
							},
							order.version,
							context,
						);
					}
				}
				const next: PurchaseEntry = {
					...entry,
					status: 'void',
					voidedBy: actor,
					voidedAt: now,
					voidReason: body.reason,
					updatedAt: now,
					updatedBy: actor,
				};
				const version = await this.entries.save(next, entry.version, context);
				const units = describeUnits(
					layerRows.map((layer) => ({
						units: layer.quantityRemaining,
						soldBy: lineBy.get(layer.sourceLineId ?? '')?.soldBy ?? 'piece',
					})),
				);
				await this.support.record(
					{
						actor,
						action: 'purchase.entry.void',
						entityType: 'purchase_entry',
						entityId: entry.id,
						text: `${await this.support.nameOf(actor)} voided ${entry.number ?? 'the entry'} (${entry.supplierName}, ${entry.billNumber}): stock −${units} across ${layerRows.length} SKU${layerRows.length === 1 ? '' : 's'}. Reason: "${body.reason}"`,
					},
					context,
				);
				return { ...next, version };
			})
			.catch((error: unknown) => {
				if (error instanceof StockMovementRefusedError) {
					throw refuse(
						'void_held',
						'Some of these pieces are held or have moved since. Release them first, then void.',
					);
				}
				throw error;
			});
		// The goods check's return drafts go with it: nothing was sent.
		for (const doc of returns.filter((row) => row.status === 'draft')) await this.returns.remove(doc.id);
		await this.searchOutbox
			?.request([...new Set(entry.lines.map((line) => line.productId))], new Date())
			.catch(() => undefined);
		return voided;
	}

	/* ------------------------------------------------------------------ payments (p11) */

	async paymentsFor(id: string): Promise<SupplierPayment[]> {
		await this.load(id);
		return this.payments.forEntry(id);
	}

	async recordPayment(id: string, write: SupplierPaymentWrite, actor: string | null): Promise<PurchaseEntry> {
		const entry = await this.load(id);
		if (entry.status !== 'posted') throw refuse('wrong_status', 'Payments are recorded against a posted entry.');
		const left = entryOutstanding(entry);
		if (write.amountINR > left + 0.005) {
			throw refuse(
				'overpayment',
				`Only ${formatRupees(Math.max(0, left))} is left to pay on this bill.`,
				'amountINR',
			);
		}
		if (write.paidOn > this.support.today())
			throw refuse('paid_in_future', 'A payment cannot be dated in the future.', 'paidOn');
		const settings = await this.support.settings();
		const closed = booksClosedProblem([write.paidOn], settings.booksClosedUpTo);
		if (closed) throw refuse(closed.code, closed.detail, 'paidOn');
		const person = samePersonProblem({
			required: settings.stepRules.paymentByDifferentPerson,
			actorId: actor,
			previousActorId: entry.postedBy,
			step: 'payment',
		});
		if (person) throw refuse(person.code, person.detail);
		const now = new Date().toISOString();
		const payment: SupplierPayment = {
			id: `pay_${randomUUID()}`,
			supplierId: entry.supplierId,
			purchaseEntryId: entry.id,
			amountINR: write.amountINR,
			paidOn: write.paidOn,
			mode: write.mode,
			reference: write.reference,
			proofAssetId: write.proofAssetId,
			createdBy: actor,
			createdAt: now,
			reversedAt: null,
			reversedBy: null,
			reverseReason: null,
		};
		return this.support.guardStale(() =>
			this.support.inTransaction(async (context) => {
				await this.payments.save(payment, context);
				const paidINR = Math.round((entry.paidINR + write.amountINR) * 100) / 100;
				const next: PurchaseEntry = { ...entry, paidINR, updatedAt: now, updatedBy: actor };
				next.paymentStatus = entryPaymentStatus(next);
				const version = await this.entries.save(next, entry.version, context);
				const modes: Record<string, string> = {
					bank_transfer: 'bank transfer',
					upi: 'UPI',
					cheque: 'cheque',
					cash: 'cash',
				};
				await this.support.record(
					{
						actor,
						action: 'purchase.payment.record',
						entityType: 'purchase_entry',
						entityId: entry.id,
						text: `${await this.support.nameOf(actor)} recorded ${formatRupees(write.amountINR)} paid to ${entry.supplierName} for ${entry.number} by ${modes[write.mode] ?? write.mode}${write.reference ? `, ref ${write.reference}` : ''}.`,
						facts: { paymentId: payment.id },
					},
					context,
				);
				return { ...next, version };
			}),
		);
	}

	async reversePayment(id: string, paymentId: string, reason: string, actor: string | null): Promise<PurchaseEntry> {
		const entry = await this.load(id);
		const payment = await this.payments.findById(paymentId);
		if (!payment || payment.purchaseEntryId !== id) throw missing('Payment');
		if (payment.reversedAt) throw refuse('already_reversed', 'This payment is already reversed.');
		const settings = await this.support.settings();
		const closed = booksClosedProblem([payment.paidOn], settings.booksClosedUpTo);
		if (closed) throw refuse(closed.code, closed.detail);
		const now = new Date().toISOString();
		return this.support.guardStale(() =>
			this.support.inTransaction(async (context) => {
				await this.payments.save(
					{ ...payment, reversedAt: now, reversedBy: actor, reverseReason: reason },
					context,
				);
				const paidINR = Math.max(0, Math.round((entry.paidINR - payment.amountINR) * 100) / 100);
				const next: PurchaseEntry = { ...entry, paidINR, updatedAt: now, updatedBy: actor };
				next.paymentStatus = entryPaymentStatus(next);
				const version = await this.entries.save(next, entry.version, context);
				await this.support.record(
					{
						actor,
						action: 'purchase.payment.reverse',
						entityType: 'purchase_entry',
						entityId: entry.id,
						text: `${await this.support.nameOf(actor)} reversed the ${formatRupees(payment.amountINR)} payment of ${payment.paidOn} on ${entry.number}: "${reason}"`,
					},
					context,
				);
				return { ...next, version };
			}),
		);
	}

	/* ------------------------------------------------------------------ list and activity */

	async list(query: PurchaseEntryListQuery): Promise<PurchaseEntryListResponse> {
		const today = this.support.today();
		const monthStart = `${today.slice(0, 7)}-01`;
		const [page, open, monthly, everything] = await Promise.all([
			this.entries.list({ ...query, today }),
			this.entries.openPayables(),
			this.entries.postedBetween(monthStart, today),
			// The tiles count the whole book, whatever the list is filtered to.
			this.entries.list({ filter: 'all', page: 1, pageSize: 1, today }),
		]);
		const owed = open.map((entry) => ({ entry, left: entryOutstanding(entry) })).filter((row) => row.left > 0.005);
		const soon = owed
			.filter((row) => row.entry.dueOn <= addDays(today, 7))
			.sort((a, b) => a.entry.dueOn.localeCompare(b.entry.dueOn));
		const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value * 100, 0)) / 100;
		return {
			items: page.items.map((entry) => ({
				id: entry.id,
				number: entry.number,
				status: entry.status,
				paymentStatus: entry.paymentStatus,
				supplierId: entry.supplierId,
				supplierName: entry.supplierName,
				billNumber: entry.billNumber,
				billDate: entry.billDate,
				dueOn: entry.dueOn,
				paidINR: entry.paidINR,
				createdAt: entry.createdAt,
				pieces: entry.lines
					.filter((line) => line.soldBy === 'piece')
					.reduce((total, line) => total + line.quantity, 0),
				totalINR: entry.totals.totalINR,
			})),
			total: page.total,
			counts: page.counts,
			tiles: {
				boughtThisMonthINR: sum(monthly.map((entry) => entry.totals.totalINR)),
				postedThisMonth: monthly.length,
				piecesThisMonth: monthly.reduce((total, entry) => total + entry.totals.pieces, 0),
				owedINR: sum(owed.map((row) => row.left)),
				owedBills: owed.length,
				dueIn7DaysINR: sum(soon.map((row) => row.left)),
				dueIn7DaysNext: soon[0]
					? { supplierName: soon[0].entry.supplierName, dueOn: soon[0].entry.dueOn }
					: null,
				drafts: (everything.counts['draft'] ?? 0) + (everything.counts['checked'] ?? 0),
			},
		};
	}

	async activity(id: string) {
		const entry = await this.load(id);
		return this.support.activity('purchase_entry', [entry.id]);
	}
}
