import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderStatus, PaymentGateway } from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Principal, assertOwnership } from '../auth/ownership';
import { type AuthenticatedPrincipal, RequireRoles } from '../auth/session.guard';
import { cookieNames } from '../common/cookies';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { OrdersService } from './orders.service';

const CreateOrderSchema = z.object({
	cartId: z.string().min(1),
	currency: z.string().length(3).optional(),
	gateway: PaymentGateway.optional(),
	couponCode: z.string().min(1).optional(),
});
type CreateOrderBody = z.infer<typeof CreateOrderSchema>;

const UpdateStatusSchema = z.object({ status: OrderStatus, note: z.string().min(1).optional() });
type UpdateStatusBody = z.infer<typeof UpdateStatusSchema>;

/**
 * Orders are owned resources, so every route here is authenticated by the global
 * `SessionGuard` (there is no `@Public()`) AND object-level authorized: a role check alone
 * would let any signed-in customer read any other customer's order by guessing an id.
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
	constructor(
		private readonly orders: OrdersService,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	@Post()
	@ApiOperation({ summary: 'Create an order from a cart' })
	create(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Body(new ZodValidationPipe(CreateOrderSchema)) body: CreateOrderBody,
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
	@ApiOperation({ summary: 'List the authenticated user’s orders' })
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
	@ApiOperation({ summary: 'Get one of the caller’s own orders' })
	async get(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		const order = await this.orders.getOrder(id);
		// Staff/admin may read any order for support; a customer may read only their own,
		// and a mismatch is a 404 so the endpoint cannot be used to probe which ids exist.
		assertOwnership({ principal, ownerUserId: order.userId, allowRoles: ['staff', 'admin'] });
		return order;
	}

	@Patch(':id/status')
	@RequireRoles('admin', 'staff')
	@ApiOperation({ summary: 'Update an order’s status (admin/staff only)' })
	updateStatus(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateStatusSchema)) body: UpdateStatusBody) {
		return this.orders.updateStatus(id, body.status, body.note);
	}
}
