import { Module } from '@nestjs/common';
import { NOT_CONNECTED_EINVOICE, NOT_CONNECTED_EWAYBILL } from '@saha-textile/core-domain';

import { AddressesModule } from '../addresses/addresses.module';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CurrencyModule } from '../currency/currency.module';
import { APP_CONFIG } from '../config/app-config';
import { buildCheckoutGateways, buildPaymentRequestPorts } from '../infra/payment-gateway-factory';
import {
	CHECKOUT_GATEWAYS,
	EINVOICE_PORT,
	EWAYBILL_PORT,
	INR_PAYMENT_GATEWAY,
	PAYMENT_REQUEST_PORTS,
} from '../infra/tokens';
import { ShippingModule } from '../shipping/shipping.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { AdminCartService } from './admin-cart.service';
import { AdminOrderCreateService } from './admin-order-create.service';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { OrderStock } from './order-stock';
import { OpenOrdersService } from './open-orders.service';
import { PayPageController } from './pay-page.controller';
import { PaymentRequestSweep } from './payment-request-sweep';
import { PaymentRequestsService } from './payment-requests.service';

/** The admin ordering system (orders and checkout brief, approved 2026-11-20). */
@Module({
	imports: [AuthModule, CatalogModule, CurrencyModule, OrdersSetupModule, AddressesModule, ShippingModule],
	controllers: [AdminOrdersController, PayPageController],
	providers: [
		AdminCartService,
		AdminOrdersService,
		AdminOrderCreateService,
		OrderStock,
		PaymentRequestsService,
		PaymentRequestSweep,
		OpenOrdersService,
		{ provide: CHECKOUT_GATEWAYS, useFactory: buildCheckoutGateways, inject: [APP_CONFIG, INR_PAYMENT_GATEWAY] },
		{ provide: PAYMENT_REQUEST_PORTS, useFactory: buildPaymentRequestPorts, inject: [CHECKOUT_GATEWAYS] },
		// No e-invoice or e-way bill integration yet: Raise falls back to typing the details by hand.
		{ provide: EINVOICE_PORT, useValue: NOT_CONNECTED_EINVOICE },
		{ provide: EWAYBILL_PORT, useValue: NOT_CONNECTED_EWAYBILL },
	],
	exports: [
		AdminCartService,
		AdminOrdersService,
		OrderStock,
		PaymentRequestsService,
		PAYMENT_REQUEST_PORTS,
		CHECKOUT_GATEWAYS,
	],
})
export class AdminOrdersModule {}
