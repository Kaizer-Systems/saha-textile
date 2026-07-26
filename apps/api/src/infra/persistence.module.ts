import { Global, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { connectMongo, disconnectMongo } from '@saha-textile/adapters-db-mongo';
import {
	MongoCartRepository,
	MongoCategoryRepository,
	MongoCurrencyRepository,
	MongoOrderRepository,
	MongoProductRepository,
	MongoPromotionRepository,
	MongoUserRepository,
} from '@saha-textile/adapters-db-mongo';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Argon2JwtAuth } from './argon2-jwt.auth';
import {
	AUTH_PORT,
	CART_REPOSITORY,
	CATEGORY_REPOSITORY,
	CURRENCY_REPOSITORY,
	ORDER_REPOSITORY,
	PRODUCT_REPOSITORY,
	PROMOTION_REPOSITORY,
	USER_REPOSITORY,
} from './tokens';

@Global()
@Module({
	providers: [
		{ provide: PRODUCT_REPOSITORY, useClass: MongoProductRepository },
		{ provide: CATEGORY_REPOSITORY, useClass: MongoCategoryRepository },
		{ provide: CURRENCY_REPOSITORY, useClass: MongoCurrencyRepository },
		{ provide: PROMOTION_REPOSITORY, useClass: MongoPromotionRepository },
		{ provide: CART_REPOSITORY, useClass: MongoCartRepository },
		{ provide: ORDER_REPOSITORY, useClass: MongoOrderRepository },
		{ provide: USER_REPOSITORY, useClass: MongoUserRepository },
		{
			provide: AUTH_PORT,
			useFactory: (config: AppConfig) => new Argon2JwtAuth(config),
			inject: [APP_CONFIG],
		},
	],
	exports: [
		PRODUCT_REPOSITORY,
		CATEGORY_REPOSITORY,
		CURRENCY_REPOSITORY,
		PROMOTION_REPOSITORY,
		CART_REPOSITORY,
		ORDER_REPOSITORY,
		USER_REPOSITORY,
		AUTH_PORT,
	],
})
export class PersistenceModule implements OnApplicationBootstrap, OnApplicationShutdown {
	private readonly logger = new Logger(PersistenceModule.name);

	async onApplicationBootstrap(): Promise<void> {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1') {
			this.logger.log('Skipping MongoDB connection for source-only documentation generation');
			return;
		}
		try {
			await connectMongo();
			this.logger.log('Connected to MongoDB');
		} catch (err) {
			// Non-fatal: the app still boots and /health stays up. DB-backed
			// endpoints will error until the connection/credentials are available.
			this.logger.warn(`MongoDB connection failed (${(err as Error).message}). DB-backed routes will fail.`);
		}
	}

	async onApplicationShutdown(): Promise<void> {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1') {
			return;
		}
		await disconnectMongo();
	}
}
