import { Body, Controller, Get, Param, Patch, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderStatus, PaymentGateway } from '@saha-textile/contracts';
import type { TokenClaims } from '@saha-textile/core-domain';
import { z } from 'zod';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
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

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
	constructor(private readonly orders: OrdersService) {}

	@Post()
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: 'Create an order from a cart' })
	create(
		@CurrentUser() user: TokenClaims | undefined,
		@Body(new ZodValidationPipe(CreateOrderSchema)) body: CreateOrderBody,
	) {
		return this.orders.createFromCart({ ...body, userId: user?.sub ?? null });
	}

	@Get()
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: 'List the authenticated user’s orders' })
	listMine(
		@CurrentUser() user: TokenClaims | undefined,
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
	) {
		if (!user) throw new UnauthorizedException();
		return this.orders.listByUser(user.sub, {
			page: page ? Number(page) : undefined,
			pageSize: pageSize ? Number(pageSize) : undefined,
		});
	}

	@Get(':id')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: 'Get an order by id' })
	get(@Param('id') id: string) {
		return this.orders.getOrder(id);
	}

	@Patch(':id/status')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles('admin', 'staff')
	@ApiBearerAuth()
	@ApiOperation({ summary: 'Update an order’s status (admin/staff only)' })
	updateStatus(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateStatusSchema)) body: UpdateStatusBody) {
		return this.orders.updateStatus(id, body.status, body.note);
	}
}
