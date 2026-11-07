import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateOrderRequest, UpdateOrderStatusRequest } from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';

import { Principal, assertOwnership } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, RequirePermissions } from '../auth/session.guard';
import { cookieNames } from '../common/cookies';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { OrdersService } from './orders.service';
import { API_TAGS } from '../openapi-tags';

/**
 * Orders are owned resources, so every route here is authenticated by the global
 * `SessionGuard` (there is no `@Public()`) AND object-level authorized: a role check alone
 * would let any signed-in customer read any other customer's order by guessing an id.
 */
@ApiTags(API_TAGS.orders)
@Controller('orders')
export class OrdersController {
	constructor(
		private readonly orders: OrdersService,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	@Post()
	@ApiOperation({ operationId: 'createOrder', summary: 'Create an order from a cart' })
	create(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Body(new ZodValidationPipe(CreateOrderRequest)) body: CreateOrderRequest,
		@Req() request: FastifyRequest,
	) {
		if (!principal) throw new UnauthorizedException();
		const names = cookieNames(this.config);
		const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies ?? {};
		return this.orders.createFromCart({
			...body,
			principal,
			guestToken: cookies[names.guest] ?? null,
		});
	}

	@Get()
	@ApiOperation({ operationId: 'listMyOrders', summary: 'List the authenticated user’s orders' })
	listMine(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
	) {
		if (!principal) throw new UnauthorizedException();
		return this.orders.listByUser(principal.userId, {
			page: page ? Number(page) : undefined,
			pageSize: pageSize ? Number(pageSize) : undefined,
		});
	}

	@Get(':id')
	@ApiOperation({ operationId: 'getOrder', summary: 'Get one of the caller’s own orders' })
	async get(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		const order = await this.orders.getOrder(id);
		// Staff/admin may read any order for support; a customer may read only their own,
		// and a mismatch is a 404 so the endpoint cannot be used to probe which ids exist.
		assertOwnership({ principal, ownerUserId: order.userId, allowPermissions: ['order.index'] });
		return order;
	}

	/**
	 * The one back-office route on an otherwise customer-facing controller.
	 *
	 * ## `@Audience('admin')` closes a real hole, not a theoretical one
	 *
	 * This route carried `@RequireRoles('admin', 'staff')` and no audience. The guard only
	 * enforces an audience when one is DECLARED, and `OrdersController` declares none — its
	 * other routes are a customer reading and placing their own orders. So a staff member who
	 * also shops on the storefront could reach this with their STOREFRONT cookie: the role
	 * check passed, and the handler ran. Probed against the real application before it was
	 * changed, and the request got as far as the repository.
	 *
	 * That is exactly the audience-confusion case the security matrix requires to be
	 * impossible — "storefront cookie against admin endpoint". The audience is declared on the
	 * ROUTE rather than the controller because the controller's other routes must stay
	 * reachable from the storefront.
	 *
	 * ## Permission rather than role
	 *
	 * The last route in the codebase still authorizing by coarse role. `admin` must not
	 * silently mean every capability (build prompt §7), and a fulfilment operator may need to
	 * advance an order without being able to read or raise one — which is why this is
	 * `order.update` rather than a reuse of `order.index`.
	 *
	 * **Operator note:** this is a behaviour change. Any role row seeded before `order.update`
	 * entered the registry does not hold it, including `administrator`, whose grant is
	 * refreshed only by re-running `seed:system-roles`. Run that after deploying, or the people
	 * who could change order status yesterday cannot today.
	 */
	@Patch(':id/status')
	@Audience('admin')
	@RequirePermissions('order.update')
	@ApiOperation({ operationId: 'updateOrderStatus', summary: 'Update an order’s status (admin audience only)' })
	updateStatus(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(UpdateOrderStatusRequest)) body: UpdateOrderStatusRequest,
	) {
		return this.orders.updateStatus(id, body.status, body.note);
	}
}
