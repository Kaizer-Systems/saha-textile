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
	InventoryCostLayer,
	Location,
	LocationStockQuery,
	LocationStockView,
	StockTransfer,
	TransferCancelWrite,
	TransferDecisionWrite,
	TransferLine,
	TransferList,
	TransferListQuery,
	TransferPackWrite,
	TransferReceiveWrite,
	TransferRequestWrite,
	TransferRow,
	TransferStatus,
	TransferView,
} from '@saha-textile/contracts';
import {
	branchInvoice,
	defaultStockLocation,
	dispatchBlockers,
	drawnValueINR,
	fifoDraw,
	istDay,
	splitArrived,
	transferDispatchPosting,
	transferReceivePosting,
	type AdminOrderRepository,
	type AuditLogRepository,
	type CompanyRepository,
	type InventoryCostLayerRepository,
	type LocationRepository,
	type OrderSettingsRepository,
	type StockHoldRepository,
	type StockMovementPort,
	type StockReadRepository,
	type TransactionContext,
	type TransactionManagerPort,
	type TransferPostingRow,
	type TransferRepository,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { DocumentFormatsService } from '../documents/document-formats.service';
import { previewDocument } from '../documents/document-previews';
import {
	ADMIN_ORDER_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	COMPANY_REPOSITORY,
	INVENTORY_COST_LAYER_REPOSITORY,
	LOCATION_REPOSITORY,
	ORDER_SETTINGS_REPOSITORY,
	STOCK_HOLD_REPOSITORY,
	STOCK_MOVEMENT,
	STOCK_READ_REPOSITORY,
	TRANSACTION_MANAGER,
	TRANSFER_REPOSITORY,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerService } from '../ledger/ledger.service';
import { LocationsService } from '../locations/locations.service';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';
import { transferDocument } from './transfer-print';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const conflict = (code: string) => new ConflictException(accountsRefusal(code));
type Scope = { all: boolean; ids: readonly string[]; userId: string | null };

/** Free to sell at a location: on hand less held and kept for orders. */
const freeOf = (row: { onHand: number; held: number; reserved: number } | undefined) =>
	row ? row.onHand - row.held - row.reserved : 0;

/**
 * Stock transfers between locations (accounts brief N; D15, D19). Request → approve at the sender (the pieces are
 * kept for it) → pack on the stock-out checklist and dispatch (the cost layers leave with the pieces; a delivery
 * challan, or a branch invoice with IGST to another GSTIN; the e-way bill above the threshold) → receive on the stock-in
 * checklist (layers re-made at the receiver at the same cost; short pieces a carrier claim or a transit loss; damaged
 * ones held). Each step writes stock, books and the audit log in one transaction.
 */
@Injectable()
export class TransfersService {
	constructor(
		@Inject(TRANSFER_REPOSITORY) private readonly repo: TransferRepository,
		@Inject(STOCK_MOVEMENT)
		private readonly stock: Pick<StockMovementPort, 'move' | 'locationStock' | 'consumeLayer'>,
		@Inject(INVENTORY_COST_LAYER_REPOSITORY)
		private readonly layers: Pick<InventoryCostLayerRepository, 'listOpenLayers' | 'createLayer'>,
		@Inject(STOCK_READ_REPOSITORY) private readonly items: Pick<StockReadRepository, 'items' | 'list'>,
		@Inject(STOCK_HOLD_REPOSITORY) private readonly holds: Pick<StockHoldRepository, 'save'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(COMPANY_REPOSITORY) private readonly company: Pick<CompanyRepository, 'getRegistration'>,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: Pick<AdminOrderRepository, 'findById'>,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		@Inject(ORDER_SETTINGS_REPOSITORY) private readonly orderSettings: Pick<OrderSettingsRepository, 'get'>,
		private readonly formats: DocumentFormatsService,
		private readonly reach: LocationsService,
		private readonly numbers: DocumentNumbersService,
		private readonly ledger: LedgerService,
	) {}

	private async scope(principal: AuthenticatedPrincipal | undefined): Promise<Scope> {
		const scope = await this.reach.scope(principal);
		return { all: scope.all, ids: scope.ids, userId: principal?.userId ?? null };
	}

	private inReach(scope: Scope, locationId: string): boolean {
		return scope.all || scope.ids.includes(locationId);
	}

	private async get(id: string, context?: TransactionContext): Promise<StockTransfer> {
		const transfer = await this.repo.get(id, context);
		if (!transfer) throw new NotFoundException(accountsRefusal('transfer_not_found'));
		return transfer;
	}

	private step(transfer: StockTransfer, status: TransferStatus, by: string | null, at: string): StockTransfer {
		return {
			...transfer,
			status,
			updatedAt: at,
			timeline: [...transfer.timeline, { status, at, by, byName: null }],
		};
	}

	private async log(by: string | null, action: string, transfer: StockTransfer, context: TransactionContext) {
		await this.audit.append(
			{
				id: `aud_${randomUUID()}`,
				actorUserId: by,
				targetUserId: null,
				audience: 'admin',
				action,
				entityType: 'stockTransfer',
				entityId: transfer.id,
				severity: 'info',
				retentionTier: 'books',
				diffs: [],
				metadata: { number: transfer.number, status: transfer.status },
				requestId: null,
				ipHash: null,
				userAgentHash: null,
				createdAt: new Date().toISOString(),
			},
			context,
		);
	}

	/** N2: ask another location for stock, for this location or for an order. */
	async request(
		write: TransferRequestWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<StockTransfer> {
		const scope = await this.scope(principal);
		if (!this.inReach(scope, write.toLocationId))
			throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		if (write.fromLocationId === write.toLocationId) throw refuse('transfer_same_location');
		const all = await this.locations.list();
		const active = (id: string) => all.find((l) => l.id === id && l.active);
		if (!active(write.fromLocationId) || !active(write.toLocationId)) throw refuse('location_unknown');
		const facts = await this.items.items(write.lines.map((l) => l.variantId));
		const lines: TransferLine[] = write.lines.map((line) => {
			const fact = facts.get(line.variantId);
			if (!fact || fact.productType === 'bundle') throw refuse('transfer_item_unknown');
			return {
				lineId: `trl_${randomUUID()}`,
				variantId: line.variantId,
				productId: fact.productId,
				sku: fact.sku,
				title: [fact.title['en'] ?? Object.values(fact.title)[0] ?? fact.sku, fact.optionsLabel]
					.filter(Boolean)
					.join(' · '),
				hsn: fact.hsnCode,
				soldBy: fact.soldBy,
				quantity: line.quantity,
				packed: 0,
				arrived: null,
				damaged: null,
				note: '',
				drawn: [],
				valueINR: null,
				holdId: null,
			};
		});
		const order = write.forOrderId ? await this.orders.findById(write.forOrderId) : null;
		if (write.forOrderId && !order) throw refuse('transfer_order_unknown');
		const at = now.toISOString();
		return this.tx.withTransaction(async (context) => {
			const transfer: StockTransfer = {
				id: `tr_${randomUUID()}`,
				number: await this.numbers.issue('stockTransfer', context, now),
				status: 'requested',
				fromLocationId: write.fromLocationId,
				toLocationId: write.toLocationId,
				lines,
				neededBy: write.neededBy,
				forOrderId: order?.id ?? null,
				forOrderNumber: order?.orderNumber ?? null,
				note: write.note,
				crossGstin: false,
				sealNumber: '',
				boxes: null,
				photoAssetIds: [],
				vehicle: '',
				ewayBillNumber: null,
				challanNumber: null,
				branchInvoice: null,
				valueINR: 0,
				short: null,
				rejectReason: null,
				voucherIds: [],
				timeline: [{ status: 'requested', at, by: scope.userId, byName: null }],
				requestedBy: scope.userId,
				version: 0,
				createdAt: at,
				updatedAt: at,
			};
			await this.repo.insert(transfer, context);
			await this.log(scope.userId, 'transfer.request', transfer, context);
			return transfer;
		});
	}

	/** At the sender: approve (the pieces are kept for this transfer) or reject with a reason. */
	async decide(
		id: string,
		write: TransferDecisionWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<StockTransfer> {
		const scope = await this.scope(principal);
		const at = now.toISOString();
		return this.tx.withTransaction(async (context) => {
			const transfer = await this.get(id, context);
			if (!this.inReach(scope, transfer.fromLocationId))
				throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
			if (transfer.status !== 'requested') throw conflict('transfer_not_waiting');
			if (!write.approve) {
				if (write.reason.length < 3) throw refuse('transfer_reason_needed');
				const rejected = { ...this.step(transfer, 'rejected', scope.userId, at), rejectReason: write.reason };
				const saved = await this.repo.save(rejected, write.version, context);
				await this.log(scope.userId, 'transfer.reject', saved, context);
				return saved;
			}
			const here = await this.stock.locationStock(transfer.lines.map((l) => l.variantId));
			for (const line of transfer.lines) {
				const row = here.find(
					(r) => r.variantId === line.variantId && r.locationId === transfer.fromLocationId,
				);
				if (freeOf(row) < line.quantity) throw conflict(`transfer_not_enough_stock:${line.sku}`);
				await this.stock.move(
					{
						variantId: line.variantId,
						productId: line.productId,
						quantityDelta: 0,
						heldDelta: 0,
						reservedDelta: line.quantity,
						source: 'transfer',
						reasonCode: 'transfer_kept',
						note: null,
						referenceType: 'stockTransfer',
						referenceId: transfer.id,
						referenceNumber: transfer.number,
						actorUserId: scope.userId,
						approverUserId: scope.userId,
						at,
						locationId: transfer.fromLocationId,
					},
					context,
				);
			}
			const saved = await this.repo.save(
				this.step(transfer, 'packing', scope.userId, at),
				write.version,
				context,
			);
			await this.log(scope.userId, 'transfer.approve', saved, context);
			return saved;
		});
	}

	/** Releases what an approved transfer kept at the sender. */
	private async release(transfer: StockTransfer, by: string | null, at: string, context: TransactionContext) {
		for (const line of transfer.lines)
			await this.stock.move(
				{
					variantId: line.variantId,
					productId: line.productId,
					quantityDelta: 0,
					heldDelta: 0,
					reservedDelta: -line.quantity,
					source: 'transfer',
					reasonCode: 'transfer_released',
					note: null,
					referenceType: 'stockTransfer',
					referenceId: transfer.id,
					referenceNumber: transfer.number,
					actorUserId: by,
					approverUserId: null,
					at,
					locationId: transfer.fromLocationId,
				},
				context,
			);
	}

	/** Before it leaves: the asker or the sender may cancel; what was kept is let go. */
	async cancel(
		id: string,
		write: TransferCancelWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<StockTransfer> {
		const scope = await this.scope(principal);
		const at = now.toISOString();
		return this.tx.withTransaction(async (context) => {
			const transfer = await this.get(id, context);
			if (!this.inReach(scope, transfer.fromLocationId) && !this.inReach(scope, transfer.toLocationId))
				throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
			if (transfer.status !== 'requested' && transfer.status !== 'packing')
				throw conflict('transfer_already_left');
			if (transfer.status === 'packing') await this.release(transfer, scope.userId, at, context);
			const cancelled = { ...this.step(transfer, 'cancelled', scope.userId, at), rejectReason: write.reason };
			const saved = await this.repo.save(cancelled, write.version, context);
			await this.log(scope.userId, 'transfer.cancel', saved, context);
			return saved;
		});
	}

	/** The sender's open layers for a variant: its own, or those with no location when it is the default one. */
	private async layersAt(variantId: string, locationId: string, defaultId: string | null) {
		return (await this.layers.listOpenLayers(variantId)).filter(
			(layer) => (layer.locationId ?? defaultId) === locationId,
		);
	}

	/** Layers placed before locations count as the default stock location's (F4). */
	private async defaultLocation(): Promise<string | null> {
		return defaultStockLocation(await this.locations.list());
	}

	/** What the pieces would cost if they left now (N5 decides the e-way bill on it). */
	async estimate(transfer: StockTransfer): Promise<number> {
		const fallback = await this.defaultLocation();
		let paise = 0;
		for (const line of transfer.lines) {
			const open = await this.layersAt(line.variantId, transfer.fromLocationId, fallback);
			paise += Math.round(fifoDraw(open, line.quantity, line.soldBy).valueINR * 100);
		}
		return paise / 100;
	}

	/** N5: the checklist as packed so far; with `dispatch`, it leaves in the same step. */
	async pack(
		id: string,
		write: TransferPackWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<StockTransfer> {
		const scope = await this.scope(principal);
		const at = now.toISOString();
		return this.tx.withTransaction(async (context) => {
			const transfer = await this.get(id, context);
			if (!this.inReach(scope, transfer.fromLocationId))
				throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
			if (transfer.status !== 'packing') throw conflict('transfer_not_packing');
			const packed = new Map(write.lines.map((l) => [l.lineId, l.packed]));
			const next: StockTransfer = {
				...transfer,
				lines: transfer.lines.map((line) => ({
					...line,
					packed: Math.min(line.quantity, packed.get(line.lineId) ?? line.packed),
				})),
				sealNumber: write.sealNumber,
				boxes: write.boxes,
				photoAssetIds: write.photoAssetIds,
				vehicle: write.vehicle,
				ewayBillNumber: write.ewayBillNumber || null,
				updatedAt: at,
			};
			if (!write.dispatch) {
				const saved = await this.repo.save(next, write.version, context);
				await this.log(scope.userId, 'transfer.pack', saved, context);
				return saved;
			}
			const dispatched = await this.dispatch(next, scope.userId, now, context);
			const saved = await this.repo.save(dispatched, write.version, context);
			await this.log(scope.userId, 'transfer.dispatch', saved, context);
			return saved;
		});
	}

	private async registrationOf(location: Location | undefined) {
		return location?.gstRegistrationId ? this.company.getRegistration(location.gstRegistrationId) : null;
	}

	/** Dispatch: the layers leave with the pieces, the documents are numbered, and the books move. */
	private async dispatch(
		transfer: StockTransfer,
		by: string | null,
		now: Date,
		context: TransactionContext,
	): Promise<StockTransfer> {
		const at = now.toISOString();
		const threshold = (await this.orderSettings.get()).eWayBillThresholdINR;
		const estimated = await this.estimate(transfer);
		const blockers = dispatchBlockers({
			lines: transfer.lines,
			sealNumber: transfer.sealNumber,
			ewayBillNeeded: estimated >= threshold,
			ewayBillNumber: transfer.ewayBillNumber,
		});
		if (blockers.length) throw refuse(`transfer_cannot_dispatch:${blockers.join(',')}`);
		const all = await this.locations.list();
		const fallback = await this.defaultLocation();
		const lines: TransferLine[] = [];
		for (const line of transfer.lines) {
			const open = await this.layersAt(line.variantId, transfer.fromLocationId, fallback);
			const draw = fifoDraw(open, line.quantity, line.soldBy);
			if (draw.uncosted > 0) throw conflict(`cost_layers_missing:${line.sku}`);
			for (const part of draw.parts) await this.stock.consumeLayer(part.layerId, part.quantity, context);
			const drawn = draw.parts.map((part) => ({
				...part,
				receivedAt: (open.find((l) => l.id === part.layerId) as InventoryCostLayer).receivedAt,
			}));
			await this.stock.move(
				{
					variantId: line.variantId,
					productId: line.productId,
					quantityDelta: -line.quantity,
					heldDelta: 0,
					reservedDelta: -line.quantity,
					source: 'transfer',
					reasonCode: 'transfer_out',
					note: null,
					referenceType: 'stockTransfer',
					referenceId: transfer.id,
					referenceNumber: transfer.number,
					actorUserId: by,
					approverUserId: null,
					at,
					locationId: transfer.fromLocationId,
				},
				context,
			);
			lines.push({ ...line, drawn, valueINR: drawnValueINR(drawn) });
		}
		const valueINR = Math.round(lines.reduce((sum, l) => sum + (l.valueINR as number) * 100, 0)) / 100;
		const [sender, receiver] = await Promise.all([
			this.registrationOf(all.find((l) => l.id === transfer.fromLocationId)),
			this.registrationOf(all.find((l) => l.id === transfer.toLocationId)),
		]);
		const crossGstin = !!sender && !!receiver && sender.gstin !== receiver.gstin;
		let invoice: StockTransfer['branchInvoice'] = null;
		let challanNumber: string | null = null;
		if (crossGstin) {
			const built = branchInvoice(
				lines.map((l) => ({ sku: l.sku, hsn: l.hsn, quantity: l.quantity, valueINR: l.valueINR as number })),
			);
			const problem = built.problems[0];
			if (problem) throw refuse(`transfer_${problem.problem}:${problem.sku}`);
			invoice = {
				number: await this.numbers.issue('taxInvoice', context, now, sender.id),
				date: istDay(now),
				fromGstin: sender.gstin,
				toGstin: receiver.gstin,
				taxableINR: built.taxableINR,
				igstINR: built.igstINR,
				totalINR: built.totalINR,
			};
		} else challanNumber = await this.numbers.issue('deliveryChallan', context, now, sender?.id);
		const voucher = await this.post(
			transfer,
			transferDispatchPosting({ crossGstin, costINR: valueINR, igstINR: invoice?.igstINR ?? 0 }),
			'dispatch',
			now,
			by,
			context,
		);
		return {
			...this.step(transfer, 'in_transit', by, at),
			lines,
			valueINR,
			crossGstin,
			branchInvoice: invoice,
			challanNumber,
			voucherIds: [...transfer.voucherIds, voucher.id],
		};
	}

	private post(
		transfer: StockTransfer,
		rows: readonly TransferPostingRow[],
		step: 'dispatch' | 'receive',
		now: Date,
		by: string | null,
		context: TransactionContext,
	) {
		return this.ledger.post(
			{
				date: istDay(now),
				narration: `Stock transfer ${transfer.number} · ${step === 'dispatch' ? 'dispatched' : 'received'}`,
				lines: rows.map((row) => ({
					ledger: { role: row.role },
					locationId: row.at === 'sender' ? transfer.fromLocationId : transfer.toLocationId,
					...(row.debitPaise !== undefined ? { debitPaise: row.debitPaise } : {}),
					...(row.creditPaise !== undefined ? { creditPaise: row.creditPaise } : {}),
				})),
				source: { type: 'stockTransfer', id: transfer.id, number: transfer.number },
				idempotencyKey: `stockTransfer:${transfer.id}:${step}`,
			},
			context,
			by,
		);
	}

	/** N6: count what arrived; what is short becomes a carrier claim or a transit loss, damaged pieces are held. */
	async receive(
		id: string,
		write: TransferReceiveWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<StockTransfer> {
		const scope = await this.scope(principal);
		const at = now.toISOString();
		return this.tx.withTransaction(async (context) => {
			const transfer = await this.get(id, context);
			if (!this.inReach(scope, transfer.toLocationId))
				throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
			if (transfer.status !== 'in_transit') throw conflict('transfer_not_in_transit');
			const counted = new Map(write.lines.map((l) => [l.lineId, l]));
			const lines: TransferLine[] = [];
			let arrivedPaise = 0;
			let short = false;
			for (const line of transfer.lines) {
				const count = counted.get(line.lineId);
				if (!count) throw refuse(`transfer_count_missing:${line.sku}`);
				if (count.arrived > line.quantity || count.damaged > count.arrived)
					throw refuse(`transfer_count_wrong:${line.sku}`);
				short ||= count.arrived < line.quantity;
				const split = splitArrived(line.drawn, count.arrived);
				for (const part of split.arrived)
					await this.layers.createLayer(
						{
							id: `layer_${randomUUID()}`,
							variantId: line.variantId,
							purchaseInvoiceId: null,
							sourceType: 'transfer',
							sourceLineId: line.lineId,
							sourceNumber: transfer.number,
							unitCostINR: part.unitCostINR,
							quantityReceived: part.quantity,
							quantityRemaining: part.quantity,
							receivedAt: part.receivedAt,
							createdAt: at,
							locationId: transfer.toLocationId,
						},
						context,
					);
				arrivedPaise += split.arrived.reduce((sum, p) => sum + Math.round(p.unitCostINR * p.quantity * 100), 0);
				let holdId: string | null = null;
				if (count.arrived > 0) {
					await this.stock.move(
						{
							variantId: line.variantId,
							productId: line.productId,
							quantityDelta: count.arrived,
							heldDelta: count.damaged,
							source: 'transfer',
							reasonCode: 'transfer_in',
							note: count.note || null,
							referenceType: 'stockTransfer',
							referenceId: transfer.id,
							referenceNumber: transfer.number,
							actorUserId: scope.userId,
							approverUserId: null,
							at,
							locationId: transfer.toLocationId,
						},
						context,
					);
				}
				if (count.damaged > 0) {
					holdId = `hold_${randomUUID()}`;
					await this.holds.save(
						{
							id: holdId,
							variantId: line.variantId,
							productId: line.productId,
							quantity: count.damaged,
							reason: 'damaged',
							note: `Arrived damaged on ${transfer.number}${count.note ? `: ${count.note}` : ''}`,
							since: at,
							byId: scope.userId,
							status: 'open',
							closedAt: null,
							closedBy: null,
							entryId: null,
						},
						context,
					);
				}
				lines.push({ ...line, arrived: count.arrived, damaged: count.damaged, note: count.note, holdId });
			}
			const voucher = await this.post(
				transfer,
				transferReceivePosting({
					crossGstin: transfer.crossGstin,
					costINR: transfer.valueINR,
					arrivedCostINR: arrivedPaise / 100,
					igstINR: transfer.branchInvoice?.igstINR ?? 0,
					short: write.short,
				}),
				'receive',
				now,
				scope.userId,
				context,
			);
			const received: StockTransfer = {
				...this.step(transfer, short ? 'received_short' : 'received', scope.userId, at),
				lines,
				short: short ? write.short : null,
				voucherIds: [...transfer.voucherIds, voucher.id],
			};
			const saved = await this.repo.save(received, write.version, context);
			await this.log(scope.userId, 'transfer.receive', saved, context);
			return saved;
		});
	}

	private rowOf(transfer: StockTransfer, all: readonly Location[]): TransferRow {
		const name = (id: string) => all.find((l) => l.id === id)?.name ?? id;
		return {
			...transfer,
			fromName: name(transfer.fromLocationId),
			toName: name(transfer.toLocationId),
			pieces: transfer.lines.reduce((sum, l) => sum + (l.soldBy === 'metre' ? 1 : l.quantity), 0),
		};
	}

	/** N3: transfers to or from the locations in reach. */
	async list(query: TransferListQuery, principal: AuthenticatedPrincipal | undefined): Promise<TransferList> {
		const scope = await this.scope(principal);
		const [page, all] = await Promise.all([
			this.repo.list({ ...query, locationIds: scope.all ? null : scope.ids }),
			this.locations.list(),
		]);
		return { items: page.items.map((t) => this.rowOf(t, all)), total: page.total, counts: page.counts };
	}

	/** N4–N6: a transfer and what this person may do with it now. */
	async view(id: string, principal: AuthenticatedPrincipal | undefined): Promise<TransferView> {
		const scope = await this.scope(principal);
		const transfer = await this.get(id);
		const sender = this.inReach(scope, transfer.fromLocationId);
		const receiver = this.inReach(scope, transfer.toLocationId);
		if (!sender && !receiver) throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		const manage = !!principal?.permissions.includes('transfer.manage');
		const open = transfer.status === 'requested' || transfer.status === 'packing';
		return {
			...this.rowOf(transfer, await this.locations.list()),
			may: {
				decide: manage && sender && transfer.status === 'requested',
				pack: manage && sender && transfer.status === 'packing',
				receive: manage && receiver && transfer.status === 'in_transit',
				cancel: manage && open,
			},
			ewayBillFromINR: (await this.orderSettings.get()).eWayBillThresholdINR,
			estimatedValueINR: open ? await this.estimate(transfer) : transfer.valueINR,
		};
	}

	/** N1: each item's stock at each location in view, the location the chip is on first; what is on the way. */
	async stockByLocation(
		query: LocationStockQuery,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<LocationStockView> {
		const scope = await this.reach.scope(principal);
		const all = (await this.locations.list()).filter((l) => l.active);
		const here = scope.current && all.some((l) => l.id === scope.current) ? scope.current : null;
		const ordered = [...all].sort((a, b) => Number(b.id === here) - Number(a.id === here));
		const page = await this.items.list({
			...(query.search ? { q: query.search } : {}),
			filter: query.chip,
			page: query.page,
			pageSize: query.pageSize,
			olderThan: now.toISOString(),
		});
		const ids = page.items.map((i) => i.variantId);
		const [rows, moving] = await Promise.all([this.stock.locationStock(ids), this.repo.inTransit(ids)]);
		return {
			here,
			locations: ordered.map((l) => ({ id: l.id, name: l.name })),
			items: page.items.map((item) => {
				const byLocation: Record<string, { onHand: number; free: number }> = {};
				for (const location of ordered) {
					const row = rows.find((r) => r.variantId === item.variantId && r.locationId === location.id);
					byLocation[location.id] = { onHand: row?.onHand ?? 0, free: freeOf(row) };
				}
				const inTransit = moving[item.variantId] ?? 0;
				return {
					variantId: item.variantId,
					productId: item.productId,
					sku: item.sku,
					title: [item.title['en'] ?? Object.values(item.title)[0] ?? item.sku, item.optionsLabel]
						.filter(Boolean)
						.join(' · '),
					soldBy: item.soldBy,
					byLocation,
					inTransit,
					total: Object.values(byLocation).reduce((sum, v) => sum + v.onHand, 0) + inTransit,
				};
			}),
			total: page.total,
		};
	}

	/** N7, N8: the delivery challan, or the branch invoice to another GSTIN, once the transfer has left. */
	async print(
		id: string,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<{ bytes: Uint8Array; fileName: string }> {
		const scope = await this.scope(principal);
		const transfer = await this.get(id);
		if (!this.inReach(scope, transfer.fromLocationId) && !this.inReach(scope, transfer.toLocationId))
			throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		if (!transfer.challanNumber && !transfer.branchInvoice) throw conflict('transfer_not_dispatched');
		const all = await this.locations.list();
		const from = all.find((l) => l.id === transfer.fromLocationId) as Location;
		const to = all.find((l) => l.id === transfer.toLocationId) as Location;
		const seller = await this.formats.seller(previewDocument('taxInvoice').seller);
		const data = transferDocument(transfer, seller, from, to);
		const bytes = await this.formats.renderActive(data.doc, data);
		return { bytes, fileName: `${data.number.replace(/\//g, '-')}.pdf` };
	}
}
