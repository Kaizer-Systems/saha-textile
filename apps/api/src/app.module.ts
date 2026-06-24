import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { CatalogModule } from './catalog/catalog.module';
import { ConfigModule } from './config/config.module';
import { CurrencyModule } from './currency/currency.module';
import { HealthModule } from './health/health.module';
import { PersistenceModule } from './infra/persistence.module';
import { OrdersModule } from './orders/orders.module';
import { PromotionsModule } from './promotions/promotions.module';

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
	],
})
export class AppModule {}
