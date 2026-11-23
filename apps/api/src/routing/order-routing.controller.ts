import { Body, Controller, Get, Header, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderRoutingSettingsWrite } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { OrderRoutingService } from './order-routing.service';

/** Settings › Order routing (accounts brief M2). */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/settings/order-routing')
export class OrderRoutingController {
	constructor(private readonly routing: OrderRoutingService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'orderRoutingSettings',
		summary: 'How a new online order gets its ships-from location',
	})
	get() {
		return this.routing.get();
	}

	@Put()
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'saveOrderRoutingSettings', summary: 'Save order routing over the copy read' })
	save(
		@Body(new ZodValidationPipe(OrderRoutingSettingsWrite)) body: OrderRoutingSettingsWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.routing.save(body, principal?.userId ?? null);
	}
}
