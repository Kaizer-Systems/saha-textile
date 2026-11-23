import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import type { Order, ShipsFromView, ShipsFromWrite } from '@saha-textile/contracts';
import {
	type AdminOrderRepository,
	type AuditLogRepository,
	defaultStockLocation,
	type LocationRepository,
	routeOrder,
	StaleRevisionError,
	type StockMovementPort,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { metaOf } from '../admin-orders/admin-orders.service';
import { OrderStock } from '../admin-orders/order-stock';
import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADMIN_ORDER_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	LOCATION_REPOSITORY,
	STOCK_MOVEMENT,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { LocationsService } from '../locations/locations.service';
import { OrderRoutingService } from './order-routing.service';

const CLOSED: readonly Order['status'][] = ['shipped', 'out_for_delivery', 'delivered', 'cancelled'];

/**
 * An order's "ships from" location (accounts brief M1, as drawn; D14). The card shows each piece's free stock at
 * each shipping location; Assign moves the order and its held pieces in one transaction: released where they
 * were kept, kept again at the new location. Split and transfer-first wait for Transfers (C3).
 */
@Injectable()
export class OrderShipsFromService {
	constructor(
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: AdminOrderRepository,
		@Inject(STOCK_MOVEMENT) private readonly stockSplit: Pick<StockMovementPort, 'locationStock'>,
		@Inject(LOCATION_REPOSITORY) private readonly locationRepo: Pick<LocationRepository, 'list'>,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		private readonly stock: OrderStock,
		private readonly routing: OrderRoutingService,
		private readonly locations: LocationsService,
	) {}

	private async order(id: string): Promise<Order> {
		const order = await this.orders.findById(id);
		if (!order) throw new NotFoundException('order_not_found');
		return order;
	}

	async view(orderId: string, principal: AuthenticatedPrincipal | undefined): Promise<ShipsFromView> {
		const order = await this.order(orderId);
		const [all, scope, settings] = await Promise.all([
			this.locationRepo.list(),
			this.locations.scope(principal),
			this.routing.get(),
		]);
		const shipping = all.filter(
			(l) => l.active && l.warehouse && l.shipsOnline && (scope.all || scope.ids.includes(l.id)),
		);
		const lines: { lineId: string; sku: string; title: string; quantity: number; variantId: string }[] = [];
		for (const line of order.lines) {
			if (line.madeToOrder || line.role === 'bundle') continue;
			lines.push({
				lineId: line.lineId ?? line.sku,
				sku: line.sku,
				title: line.title['en'] ?? Object.values(line.title)[0] ?? line.sku,
				quantity: line.quantity,
				variantId: await this.stock.variantIdOf(line),
			});
		}
		// This order's own kept pieces are free for itself: add them back where they are kept.
		const keptAt = order.shipsFromLocationId ?? defaultStockLocation(all);
		const own = new Map<string, number>();
		order.lines.forEach((line) => {
			const match = lines.find((l) => l.lineId === (line.lineId ?? line.sku));
			if (line.held && match) own.set(match.variantId, (own.get(match.variantId) ?? 0) + line.quantity);
		});
		const split = (await this.stockSplit.locationStock(lines.map((l) => l.variantId))).map((row) =>
			row.locationId === keptAt && own.has(row.variantId)
				? { ...row, reserved: Math.max(0, row.reserved - (own.get(row.variantId) ?? 0)) }
				: row,
		);
		const freeAt = (variantId: string, locationId: string) => {
			const row = split.find((s) => s.variantId === variantId && s.locationId === locationId);
			return row ? Math.max(0, row.onHand - row.held - row.reserved) : 0;
		};
		const routed = routeOrder(
			{
				lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
				stock: split,
				shippingLocationIds: shipping.map((l) => l.id),
				defaultLocationId: defaultStockLocation(all),
			},
			settings,
		);
		return {
			orderId: order.id,
			revision: order.revision,
			current: order.shipsFromLocationId ?? null,
			open: !CLOSED.includes(order.status),
			locations: shipping.map((l) => ({ id: l.id, name: l.name, shortCode: l.shortCode })),
			lines: lines.map(({ variantId, ...line }) => ({
				...line,
				free: Object.fromEntries(shipping.map((l) => [l.id, freeAt(variantId, l.id)])),
			})),
			candidates: routed.candidates,
		};
	}

	/** M1 Assign: owners and admins any location; others only between the locations they work at. */
	async assign(
		orderId: string,
		write: ShipsFromWrite,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<Order> {
		const order = await this.order(orderId);
		if (CLOSED.includes(order.status)) throw new BadRequestException('ships_from_closed');
		const scope = await this.locations.scope(principal);
		const reachable = (id: string | null) => id === null || scope.all || scope.ids.includes(id);
		if (!reachable(order.shipsFromLocationId ?? null) || !reachable(write.locationId))
			throw new ForbiddenException('location_out_of_scope');
		if (write.locationId) {
			const target = (await this.locationRepo.list()).find((l) => l.id === write.locationId);
			if (!target?.active || !target.warehouse) throw new BadRequestException('location_cannot_ship');
		}
		if ((order.shipsFromLocationId ?? null) === write.locationId) return order;
		const at = new Date().toISOString();
		const held = order.lines.filter((line) => line.held);
		const next: Order = { ...order, shipsFromLocationId: write.locationId };
		try {
			return await this.tx.withTransaction(async (context) => {
				// The held pieces move with the order: released where they were kept, kept again at the new place.
				await this.stock.release(order, held, principal?.userId ?? null, context, at);
				await this.stock.reserve(next, held, principal?.userId ?? null, context, at);
				const saved = await this.orders.update(next, write.revision, context, metaOf(next));
				await this.audit.append(
					{
						id: `aud_${randomUUID()}`,
						actorUserId: principal?.userId ?? null,
						targetUserId: null,
						audience: 'admin',
						action: 'order.ships_from',
						entityType: 'order',
						entityId: order.id,
						severity: 'info',
						retentionTier: 'financial_security',
						diffs: [
							{
								field: 'shipsFromLocationId',
								before: order.shipsFromLocationId ?? null,
								after: write.locationId,
							},
						],
						metadata: { orderNumber: order.orderNumber, reason: write.reason },
						requestId: null,
						ipHash: null,
						userAgentHash: null,
						createdAt: at,
					},
					context,
				);
				return saved;
			});
		} catch (error) {
			if (error instanceof StaleRevisionError) throw new ConflictException('order_changed');
			throw error;
		}
	}
}
