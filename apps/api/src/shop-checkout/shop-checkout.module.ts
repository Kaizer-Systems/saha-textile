import { Module } from '@nestjs/common';

import { AddressesModule } from '../addresses/addresses.module';
import { AdminOrdersModule } from '../admin-orders/admin-orders.module';
import { AuthModule } from '../auth/auth.module';
import { CartLinesModule } from '../cart/cart-lines.module';
import { CurrencyModule } from '../currency/currency.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { ShippingModule } from '../shipping/shipping.module';
import { ShopCheckoutController } from './shop-checkout.controller';
import { ShopCheckoutService } from './shop-checkout.service';

/** The shop checkout (orders and checkout brief, approved 2026-11-20). */
@Module({
	imports: [
		AuthModule,
		CartLinesModule,
		AddressesModule,
		ShippingModule,
		CurrencyModule,
		OrdersSetupModule,
		AdminOrdersModule,
	],
	controllers: [ShopCheckoutController],
	providers: [ShopCheckoutService],
})
export class ShopCheckoutModule {}
