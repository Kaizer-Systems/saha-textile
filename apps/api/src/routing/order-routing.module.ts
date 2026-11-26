import { Module } from '@nestjs/common';

import { OrderRoutingController } from './order-routing.controller';
import { OrderRoutingService } from './order-routing.service';

/** Order routing (accounts brief M): the settings now; the order's ships-from location builds on them. */
@Module({
	controllers: [OrderRoutingController],
	providers: [OrderRoutingService],
	exports: [OrderRoutingService],
})
export class OrderRoutingModule {}
