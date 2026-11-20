import { Module } from '@nestjs/common';
import { NOT_CONNECTED_EINVOICE, NOT_CONNECTED_EWAYBILL } from '@saha-textile/core-domain';

import { AddressesModule } from '../addresses/addresses.module';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CurrencyModule } from '../currency/currency.module';
import { EINVOICE_PORT, EWAYBILL_PORT } from '../infra/tokens';
import { ShippingModule } from '../shipping/shipping.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { AdminCartService } from './admin-cart.service';
import { AdminOrderCreateService } from './admin-order-create.service';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { OrderStock } from './order-stock';

/** The admin ordering system (orders and checkout brief, approved 2026-11-20). */
@Module({
	imports: [AuthModule, CatalogModule, CurrencyModule, OrdersSetupModule, AddressesModule, ShippingModule],
	controllers: [AdminOrdersController],
	providers: [
		AdminCartService,
		AdminOrdersService,
		AdminOrderCreateService,
		OrderStock,
		// No e-invoice or e-way bill integration yet: Raise falls back to typing the details by hand.
		{ provide: EINVOICE_PORT, useValue: NOT_CONNECTED_EINVOICE },
		{ provide: EWAYBILL_PORT, useValue: NOT_CONNECTED_EWAYBILL },
	],
	exports: [AdminCartService, AdminOrdersService],
})
export class AdminOrdersModule {}
