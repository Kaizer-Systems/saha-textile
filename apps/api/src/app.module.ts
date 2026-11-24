import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BlogModule } from './blog/blog.module';
import { LegalPagesModule } from './legal/legal-pages.module';
import { PageBuilderModule } from './page-builder/page-builder.module';
import { EventsModule } from './events/events.module';
import { MailboxesModule } from './mailboxes/mailboxes.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { CompanyModule } from './company/company.module';
import { LedgerModule } from './ledger/ledger.module';
import { ReturnsModule } from './returns/returns.module';
import { SelfInvoicesModule } from './self-invoices/self-invoices.module';
import { CashModule } from './cash/cash.module';
import { CounterModule } from './counter/counter.module';
import { TransfersModule } from './transfers/transfers.module';
import { BanksModule } from './banks/banks.module';
import { GstSetOffModule } from './gst/gst-set-off.module';
import { GstModule } from './gst/gst.module';
import { OrderRoutingModule } from './routing/order-routing.module';
import { OrderShipsFromModule } from './routing/order-ships-from.module';
import { LocationsModule } from './locations/locations.module';
import { DocumentsModule } from './documents/documents.module';
import { ShippingModule } from './shipping/shipping.module';
import { StoreLocationsModule } from './stores/store-locations.module';
import { CommunicationsModule } from './communications/communications.module';
import { LanguagesModule } from './languages/languages.module';
import { WishlistModule } from './wishlist/wishlist.module';
import { CartLinesModule } from './cart/cart-lines.module';
import { CookieAudienceGuard } from './common/cookie-audience.guard';
import { CsrfGuard } from './common/csrf.guard';
import { RefreshReuseGuard } from './auth/refresh-reuse.guard';
import { SessionGuard } from './auth/session.guard';
import { CatalogModule } from './catalog/catalog.module';
import type { AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { CurrencyModule } from './currency/currency.module';
import { FxModule } from './fx/fx.module';
import { AddressesModule } from './addresses/addresses.module';
import { AdminOrdersModule } from './admin-orders/admin-orders.module';
import { ShopCheckoutModule } from './shop-checkout/shop-checkout.module';
import { GeoModule } from './geo/geo.module';
import { OrdersSetupModule } from './orders-setup/orders-setup.module';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media/media.module';
import { PersistenceModule } from './infra/persistence.module';
import { OrdersModule } from './orders/orders.module';
import { PrivacyModule } from './privacy/privacy.module';
import { PromotionsModule } from './promotions/promotions.module';
import { SecurityModule } from './security/security.module';
import { StorefrontModule } from './storefront/storefront.module';
import { OpsModule } from './ops/ops.module';

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
				FxModule,
				OrdersSetupModule,
				GeoModule,
				AddressesModule,
				AdminOrdersModule,
				ShopCheckoutModule,
				PromotionsModule,
				CartLinesModule,
				OrdersModule,
				AuthModule,
				AdminModule,
				SecurityModule,
				StorefrontModule,
				PrivacyModule,
				MediaModule,
				BlogModule,
				LegalPagesModule,
				PageBuilderModule,
				EventsModule,
				StoreLocationsModule,
				ShippingModule,
				CommunicationsModule,
				MailboxesModule,
				PurchasingModule,
				CompanyModule,
				LocationsModule,
				LedgerModule,
				ReturnsModule,
				SelfInvoicesModule,
				CashModule,
				CounterModule,
				TransfersModule,
				BanksModule,
				GstModule,
				GstSetOffModule,
				OrderRoutingModule,
				OrderShipsFromModule,
				DocumentsModule,
				WishlistModule,
				LanguagesModule,
				OpsModule,
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
				// First of all: decide which audience's cookies this route reads (admin or
				// storefront), so every guard below looks at the right session.
				{ provide: APP_GUARD, useClass: CookieAudienceGuard },
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
