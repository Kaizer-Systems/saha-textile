import { Module } from '@nestjs/common';
import { ExchangeRateApiFxAdapter } from '@saha-textile/adapters-fx';

import { AuthModule } from '../auth/auth.module';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { FX_RATE_PORT, FxAdminService } from './fx-admin.service';
import { AdminFxController, AdminPaymentRoutingController } from './fx.controller';
import { PaymentRoutingService } from './payment-routing.service';

/** Exchange rates, the PayPal markup and gateway routing (shipping rules brief fx01–fx03, pay01). */
@Module({
	imports: [AuthModule],
	controllers: [AdminFxController, AdminPaymentRoutingController],
	providers: [
		FxAdminService,
		PaymentRoutingService,
		{
			provide: FX_RATE_PORT,
			inject: [APP_CONFIG],
			useFactory: (config: AppConfig) =>
				new ExchangeRateApiFxAdapter({ apiKey: config.fx.exchangeRateApiKey ?? null }),
		},
	],
	exports: [PaymentRoutingService, FX_RATE_PORT],
})
export class FxModule {}
