import { Module } from '@nestjs/common';

import { AddressesModule } from '../addresses/addresses.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ReturnsModule } from '../returns/returns.module';
import { AdminOrdersModule } from '../admin-orders/admin-orders.module';
import { AuthModule } from '../auth/auth.module';
import { CartLinesModule } from '../cart/cart-lines.module';
import { CurrencyModule } from '../currency/currency.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { ShippingModule } from '../shipping/shipping.module';
import { PaymentCallbacksController } from './payment-callbacks.controller';
import { ShopCheckoutController } from './shop-checkout.controller';
import { ShopCheckoutService } from './shop-checkout.service';
import { ShopPaymentSweep } from './shop-payment-sweep';
import { ShopPaymentsService } from './shop-payments.service';

/** The shop checkout and its payments (orders and checkout brief, approved 2026-11-20; OD1). */
@Module({
	imports: [
		AuthModule,
		CartLinesModule,
		AddressesModule,
		ShippingModule,
		CurrencyModule,
		OrdersSetupModule,
		AdminOrdersModule,
		LedgerModule,
		ReturnsModule,
	],
	controllers: [ShopCheckoutController, PaymentCallbacksController],
	providers: [ShopCheckoutService, ShopPaymentsService, ShopPaymentSweep],
})
export class ShopCheckoutModule {}
