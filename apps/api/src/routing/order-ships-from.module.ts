import { Module } from '@nestjs/common';

import { AdminOrdersModule } from '../admin-orders/admin-orders.module';
import { LocationsModule } from '../locations/locations.module';
import { OrderRoutingModule } from './order-routing.module';
import { OrderShipsFromController } from './order-ships-from.controller';
import { OrderShipsFromService } from './order-ships-from.service';

/** Ships from and Assign location on the order page (accounts brief M1). */
@Module({
	imports: [AdminOrdersModule, LocationsModule, OrderRoutingModule],
	controllers: [OrderShipsFromController],
	providers: [OrderShipsFromService],
})
export class OrderShipsFromModule {}
