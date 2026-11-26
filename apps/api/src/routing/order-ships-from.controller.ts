import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ShipsFromWrite } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { OrderShipsFromService } from './order-ships-from.service';

/** The order page's Ships from card and Assign location (accounts brief M1). */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/orders/:id/ships-from')
export class OrderShipsFromController {
	constructor(private readonly shipsFrom: OrderShipsFromService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.index')
	@ApiOperation({ operationId: 'orderShipsFrom', summary: 'Where an order ships from, with free stock per location' })
	view(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.shipsFrom.view(id, principal);
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('order.edit')
	@ApiOperation({ operationId: 'assignShipsFrom', summary: 'Assign or change where an order ships from' })
	assign(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ShipsFromWrite)) body: ShipsFromWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.shipsFrom.assign(id, body, principal);
	}
}
