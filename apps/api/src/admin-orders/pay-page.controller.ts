import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PayPageView } from '@saha-textile/contracts';

import { Public } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';
import { PaymentRequestsService } from './payment-requests.service';

/**
 * Our pay page's data (brief shop10, shop11; K1): sahatextile.com/pay/<token> shows the order and
 * the amount, and starts the gateway only when Pay is pressed. The token is long and random and is
 * looked up by its hash; nothing personal beyond the delivery city is shown.
 */
@ApiTags(API_TAGS.orders)
@Controller('storefront/pay')
export class PayPageController {
	constructor(private readonly requests: PaymentRequestsService) {}

	@Get(':token')
	@Public()
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'getPayPage', summary: 'What the pay page shows for a payment link' })
	view(@Param('token') token: string): Promise<PayPageView> {
		return this.requests.payPage(token);
	}
}
