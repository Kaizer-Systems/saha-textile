import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { CsrfGuard } from './common/csrf.guard';
import { RefreshReuseGuard } from './auth/refresh-reuse.guard';
import { SessionGuard } from './auth/session.guard';
import { CatalogModule } from './catalog/catalog.module';
import type { AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { CurrencyModule } from './currency/currency.module';
import { HealthModule } from './health/health.module';
import { PersistenceModule } from './infra/persistence.module';
import { OrdersModule } from './orders/orders.module';
import { PrivacyModule } from './privacy/privacy.module';
import { PromotionsModule } from './promotions/promotions.module';
import { SecurityModule } from './security/security.module';

/**
 * Composition root.
 *
 * `forRoot` takes the configuration rather than letting each module read `process.env`, so
 * the application a caller composes is genuinely the one it was handed. Omitting the
 * argument loads from the environment, which is what process startup wants.
 */
@Module({})
export class AppModule {
	static forRoot(config?: AppConfig): DynamicModule {
		return {
			module: AppModule,
			imports: [
				ConfigModule.forRoot(config),
				PersistenceModule,
				HealthModule,
				CatalogModule,
				CurrencyModule,
				PromotionsModule,
				CartModule,
				OrdersModule,
				AuthModule,
				AdminModule,
				SecurityModule,
				PrivacyModule,
			],
			providers: [
				// Ordered deliberately, and the order is itself a security property.
				//
				// Reuse detection runs FIRST, ahead of CSRF. A refresh token that was already
				// rotated away is proof of compromise however the request is shaped, and letting
				// CsrfGuard reject it first meant the family was never revoked: an attacker
				// holding only a stolen refresh cookie got a quiet 403 while the legitimate
				// session kept working and no security event was recorded. It costs nothing
				// elsewhere — the guard returns immediately unless the handler is marked
				// `@RotatesSession()`.
				{ provide: APP_GUARD, useClass: RefreshReuseGuard },
				// Applied to every route: unsafe methods carrying a session cookie must echo the
				// double-submit token. Registering it globally means a new controller is protected
				// by default instead of by remembering to opt in.
				{ provide: APP_GUARD, useClass: CsrfGuard },
				// Runs after CSRF: a forged request is rejected before it is ever authenticated.
				// Routes opt out with @Public(); everything else needs a valid session cookie.
				{ provide: APP_GUARD, useClass: SessionGuard },
			],
		};
	}
}
