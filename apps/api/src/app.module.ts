import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { CsrfGuard } from './common/csrf.guard';
import { CatalogModule } from './catalog/catalog.module';
import { ConfigModule } from './config/config.module';
import { CurrencyModule } from './currency/currency.module';
import { HealthModule } from './health/health.module';
import { PersistenceModule } from './infra/persistence.module';
import { OrdersModule } from './orders/orders.module';
import { PromotionsModule } from './promotions/promotions.module';
import { SecurityModule } from './security/security.module';

@Module({
	imports: [
		ConfigModule,
		PersistenceModule,
		HealthModule,
		CatalogModule,
		CurrencyModule,
		PromotionsModule,
		CartModule,
		OrdersModule,
		AuthModule,
		SecurityModule,
	],
	providers: [
		// Applied to every route: unsafe methods carrying a session cookie must echo the
		// double-submit token. Registering it globally means a new controller is protected
		// by default instead of by remembering to opt in.
		{ provide: APP_GUARD, useClass: CsrfGuard },
	],
})
export class AppModule {}
