import { Global, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
	MongoAdminInviteRepository,
	MongoAdminUserAuthRepository,
	MongoAdminUserRepository,
	MongoAuthRateLimitRepository,
	MongoAuthSessionRepository,
	MongoAuditLogRepository,
	MongoConsentRepository,
	MongoCustomerAuthRepository,
	MongoCustomerRepository,
	MongoEmailVerificationTokenRepository,
	MongoMessageOutboxRepository,
	MongoNotificationSettingsRepository,
	MongoNotificationTemplateRepository,
	MongoOAuthStateRepository,
	MongoPendingSignupRepository,
	MongoPendingContactChangeRepository,
	MongoAuthIdentityRepository,
	MongoOtpChallengeRepository,
	MongoPasswordResetTokenRepository,
	MongoRoleRepository,
	MongoTransactionManager,
	MongoAdminUserRoleAssignmentRepository,
	MongoContentBlockRepository,
	MongoMediaAssetRepository,
	MongoMediaRoleRepository,
	MongoReviewRepository,
	MongoSeoRouteRepository,
	MongoFaqRepository,
	MongoProductQuestionRepository,
	MongoProductRelationRepository,
	MongoProductBundleRepository,
	MongoSiteSettingsRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import {
	MongoCartRepository,
	MongoAttributeDefinitionRepository,
	MongoCategoryPlacementRepository,
	MongoCategoryRepository,
	MongoCurrencyRepository,
	MongoOrderRepository,
	MongoProductRepository,
	MongoPromotionRepository,
	MongoProductVariantRepository,
	MongoSeoRedirectRepository,
	MongoAddonTemplateRepository,
	MongoStockAlertRepository,
} from '@saha-textile/adapters-db-mongo';
import { CloudflareCdnPurge } from '@saha-textile/adapters-cdn-cloudflare';
import { BullMqMediaJobQueue } from '@saha-textile/adapters-queue-bullmq';
import { SpacesStorageAdapter } from '@saha-textile/adapters-storage-spaces';
import { YouTubeDataApi } from '@saha-textile/adapters-youtube';
import type {
	ConsentRepository,
	MessageOutboxRepository,
	NotificationSettingsRepository,
	NotificationTemplateRepository,
} from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Argon2JwtAuth } from './argon2-jwt.auth';
import { LogOnlyCdnPurgeAdapter } from './log-only-cdn-purge.adapter';
import { UnavailableYouTubeAdapter } from './unavailable-youtube.adapter';
import { UnconfiguredStorageAdapter } from './unconfigured-storage.adapter';
import { buildNotificationPort } from './notification-factory';
import { MongoListing } from '../catalog/mongo-listing';
import { ResilientListing } from '../catalog/resilient-listing';
import { MeilisearchListing } from '../search/meilisearch-listing';
import { MeilisearchSearch } from '../search/meilisearch-search';
import {
	AUTH_PORT,
	CART_REPOSITORY,
	ATTRIBUTE_DEFINITION_REPOSITORY,
	CATEGORY_PLACEMENT_REPOSITORY,
	CATEGORY_REPOSITORY,
	CURRENCY_REPOSITORY,
	ORDER_REPOSITORY,
	PRODUCT_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	SEO_REDIRECT_REPOSITORY,
	SEO_ROUTE_REPOSITORY,
	STOCK_ALERT_REPOSITORY,
	FAQ_REPOSITORY,
	PRODUCT_QUESTION_REPOSITORY,
	PRODUCT_RELATION_REPOSITORY,
	PRODUCT_BUNDLE_REPOSITORY,
	LISTING_PORT,
	SEARCH_PORT,
	ADDON_TEMPLATE_REPOSITORY,
	ADMIN_INVITE_REPOSITORY,
	ADMIN_USER_AUTH_REPOSITORY,
	ADMIN_USER_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	CONSENT_REPOSITORY,
	AUTH_RATE_LIMIT_REPOSITORY,
	AUTH_SESSION_REPOSITORY,
	CUSTOMER_AUTH_REPOSITORY,
	CUSTOMER_REPOSITORY,
	ROLE_REPOSITORY,
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	EMAIL_VERIFICATION_TOKEN_REPOSITORY,
	OAUTH_STATE_REPOSITORY,
	PENDING_SIGNUP_REPOSITORY,
	PENDING_CONTACT_CHANGE_REPOSITORY,
	AUTH_IDENTITY_REPOSITORY,
	MESSAGE_OUTBOX_REPOSITORY,
	NOTIFICATION_PORT,
	STORAGE_PORT,
	NOTIFICATION_SETTINGS_REPOSITORY,
	NOTIFICATION_TEMPLATE_REPOSITORY,
	OTP_CHALLENGE_REPOSITORY,
	PASSWORD_RESET_TOKEN_REPOSITORY,
	PROMOTION_REPOSITORY,
	TRANSACTION_MANAGER,
	MEDIA_ASSET_REPOSITORY,
	MEDIA_ROLE_REPOSITORY,
	CONTENT_BLOCK_REPOSITORY,
	SITE_SETTINGS_REPOSITORY,
	REVIEW_REPOSITORY,
	MEDIA_JOB_QUEUE,
	CDN_PURGE,
	YOUTUBE_PORT,
} from './tokens';

@Global()
@Module({
	providers: [
		{ provide: PRODUCT_REPOSITORY, useClass: MongoProductRepository },
		{ provide: PRODUCT_VARIANT_REPOSITORY, useClass: MongoProductVariantRepository },
		{ provide: SEO_REDIRECT_REPOSITORY, useClass: MongoSeoRedirectRepository },
		{ provide: SEO_ROUTE_REPOSITORY, useClass: MongoSeoRouteRepository },
		{ provide: STOCK_ALERT_REPOSITORY, useClass: MongoStockAlertRepository },
		{ provide: FAQ_REPOSITORY, useClass: MongoFaqRepository },
		{ provide: PRODUCT_QUESTION_REPOSITORY, useClass: MongoProductQuestionRepository },
		{ provide: PRODUCT_RELATION_REPOSITORY, useClass: MongoProductRelationRepository },
		{ provide: PRODUCT_BUNDLE_REPOSITORY, useClass: MongoProductBundleRepository },
		{
			provide: SEARCH_PORT,
			useFactory: (products: MongoProductRepository, config: AppConfig) =>
				new MeilisearchSearch(
					config.search.host,
					config.search.apiKey,
					async (ids) => {
						const found = [];
						for (const id of ids) {
							const product = await products.findById(id, 'public');
							if (product) found.push(product);
						}
						return found;
					},
					config.search.index,
					config.locales,
				),
			inject: [PRODUCT_REPOSITORY, APP_CONFIG],
		},
		{
			provide: LISTING_PORT,
			useFactory: (
				search: MeilisearchSearch,
				products: MongoProductRepository,
				variants: MongoProductVariantRepository,
				config: AppConfig,
			) => {
				const mongo = new MongoListing(products, variants);
				return config.search.host ? new ResilientListing(new MeilisearchListing(search), mongo) : mongo;
			},
			inject: [SEARCH_PORT, PRODUCT_REPOSITORY, PRODUCT_VARIANT_REPOSITORY, APP_CONFIG],
		},
		{ provide: ADDON_TEMPLATE_REPOSITORY, useClass: MongoAddonTemplateRepository },
		{ provide: CATEGORY_REPOSITORY, useClass: MongoCategoryRepository },
		{ provide: CATEGORY_PLACEMENT_REPOSITORY, useClass: MongoCategoryPlacementRepository },
		{ provide: ATTRIBUTE_DEFINITION_REPOSITORY, useClass: MongoAttributeDefinitionRepository },
		{ provide: CURRENCY_REPOSITORY, useClass: MongoCurrencyRepository },
		{ provide: PROMOTION_REPOSITORY, useClass: MongoPromotionRepository },
		{ provide: CART_REPOSITORY, useClass: MongoCartRepository },
		{ provide: ORDER_REPOSITORY, useClass: MongoOrderRepository },
		{ provide: CUSTOMER_REPOSITORY, useClass: MongoCustomerRepository },
		{ provide: ADMIN_USER_REPOSITORY, useClass: MongoAdminUserRepository },
		// Unit-of-work boundary: multi-document commerce writes commit or roll back together.
		{ provide: TRANSACTION_MANAGER, useClass: MongoTransactionManager },
		// Chunk D auth stores. Credential material lives behind these ports only.
		{ provide: AUTH_SESSION_REPOSITORY, useClass: MongoAuthSessionRepository },
		{ provide: CUSTOMER_AUTH_REPOSITORY, useClass: MongoCustomerAuthRepository },
		{ provide: ADMIN_USER_AUTH_REPOSITORY, useClass: MongoAdminUserAuthRepository },
		{ provide: ROLE_REPOSITORY, useClass: MongoRoleRepository },
		{ provide: ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY, useClass: MongoAdminUserRoleAssignmentRepository },
		{ provide: OTP_CHALLENGE_REPOSITORY, useClass: MongoOtpChallengeRepository },
		{ provide: OAUTH_STATE_REPOSITORY, useClass: MongoOAuthStateRepository },
		{ provide: PENDING_SIGNUP_REPOSITORY, useClass: MongoPendingSignupRepository },
		{ provide: PENDING_CONTACT_CHANGE_REPOSITORY, useClass: MongoPendingContactChangeRepository },
		{ provide: AUTH_IDENTITY_REPOSITORY, useClass: MongoAuthIdentityRepository },
		{ provide: PASSWORD_RESET_TOKEN_REPOSITORY, useClass: MongoPasswordResetTokenRepository },
		{ provide: EMAIL_VERIFICATION_TOKEN_REPOSITORY, useClass: MongoEmailVerificationTokenRepository },
		{ provide: ADMIN_INVITE_REPOSITORY, useClass: MongoAdminInviteRepository },
		{ provide: AUTH_RATE_LIMIT_REPOSITORY, useClass: MongoAuthRateLimitRepository },
		{ provide: CONSENT_REPOSITORY, useClass: MongoConsentRepository },
		// Owner lock: every admin mutation writes an audit record.
		{ provide: AUDIT_LOG_REPOSITORY, useClass: MongoAuditLogRepository },
		{ provide: NOTIFICATION_SETTINGS_REPOSITORY, useClass: MongoNotificationSettingsRepository },
		{ provide: NOTIFICATION_TEMPLATE_REPOSITORY, useClass: MongoNotificationTemplateRepository },
		{ provide: MESSAGE_OUTBOX_REPOSITORY, useClass: MongoMessageOutboxRepository },
		{
			// Object storage behind StoragePort. Fully configured or explicitly unavailable —
			// `configured` is computed in app-config, where a half-set credential trio is already
			// a boot-time error, so by here the choice is genuinely binary.
			provide: STORAGE_PORT,
			useFactory: (config: AppConfig) => {
				// Narrowed on the credentials themselves rather than on the `configured` flag: the
				// two can only ever agree, but checking the values is what lets the compiler prove
				// the adapter gets three strings — no assertions to fall out of date.
				const { key, secret, bucket, region, endpoint, cdnUrl } = config.spaces;
				if (!key || !secret || !bucket) {
					return new UnconfiguredStorageAdapter();
				}
				return new SpacesStorageAdapter({ key, secret, bucket, region, endpoint, cdnUrl });
			},
			inject: [APP_CONFIG],
		},
		{
			provide: NOTIFICATION_PORT,
			useFactory: (
				config: AppConfig,
				settings: NotificationSettingsRepository,
				templates: NotificationTemplateRepository,
				outbox: MessageOutboxRepository,
				consent: ConsentRepository,
			) => buildNotificationPort(config, { settings, templates, outbox, consent }),
			inject: [
				APP_CONFIG,
				NOTIFICATION_SETTINGS_REPOSITORY,
				NOTIFICATION_TEMPLATE_REPOSITORY,
				MESSAGE_OUTBOX_REPOSITORY,
				CONSENT_REPOSITORY,
			],
		},
		// Media pipeline (owner log § Media).
		{ provide: MEDIA_ASSET_REPOSITORY, useClass: MongoMediaAssetRepository },
		{ provide: MEDIA_ROLE_REPOSITORY, useClass: MongoMediaRoleRepository },
		{ provide: CONTENT_BLOCK_REPOSITORY, useClass: MongoContentBlockRepository },
		{ provide: SITE_SETTINGS_REPOSITORY, useClass: MongoSiteSettingsRepository },
		{ provide: REVIEW_REPOSITORY, useClass: MongoReviewRepository },
		{
			provide: MEDIA_JOB_QUEUE,
			useFactory: (config: AppConfig) => new BullMqMediaJobQueue(config.redis),
			inject: [APP_CONFIG],
		},
		{
			provide: CDN_PURGE,
			useFactory: (config: AppConfig) => {
				const { cloudflareZoneId, cloudflarePurgeToken } = config.media;
				return cloudflareZoneId && cloudflarePurgeToken
					? new CloudflareCdnPurge({ zoneId: cloudflareZoneId, apiToken: cloudflarePurgeToken })
					: new LogOnlyCdnPurgeAdapter();
			},
			inject: [APP_CONFIG],
		},
		{
			provide: YOUTUBE_PORT,
			useFactory: (config: AppConfig) =>
				config.media.youtubeApiKey
					? new YouTubeDataApi({ apiKey: config.media.youtubeApiKey })
					: new UnavailableYouTubeAdapter(),
			inject: [APP_CONFIG],
		},
		{
			provide: AUTH_PORT,
			useFactory: (config: AppConfig) => new Argon2JwtAuth(config),
			inject: [APP_CONFIG],
		},
	],
	exports: [
		PRODUCT_REPOSITORY,
		PRODUCT_VARIANT_REPOSITORY,
		SEO_REDIRECT_REPOSITORY,
		SEO_ROUTE_REPOSITORY,
		STOCK_ALERT_REPOSITORY,
		FAQ_REPOSITORY,
		PRODUCT_QUESTION_REPOSITORY,
		PRODUCT_RELATION_REPOSITORY,
		PRODUCT_BUNDLE_REPOSITORY,
		LISTING_PORT,
	SEARCH_PORT,
		ADDON_TEMPLATE_REPOSITORY,
		ATTRIBUTE_DEFINITION_REPOSITORY,
		CATEGORY_PLACEMENT_REPOSITORY,
		CATEGORY_REPOSITORY,
		CURRENCY_REPOSITORY,
		PROMOTION_REPOSITORY,
		CART_REPOSITORY,
		ORDER_REPOSITORY,
		CUSTOMER_REPOSITORY,
		ADMIN_USER_REPOSITORY,
		TRANSACTION_MANAGER,
		AUTH_SESSION_REPOSITORY,
		CUSTOMER_AUTH_REPOSITORY,
		ADMIN_USER_AUTH_REPOSITORY,
		ROLE_REPOSITORY,
		ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
		NOTIFICATION_PORT,
		NOTIFICATION_SETTINGS_REPOSITORY,
		NOTIFICATION_TEMPLATE_REPOSITORY,
		MESSAGE_OUTBOX_REPOSITORY,
		OTP_CHALLENGE_REPOSITORY,
		OAUTH_STATE_REPOSITORY,
		PENDING_SIGNUP_REPOSITORY,
		PENDING_CONTACT_CHANGE_REPOSITORY,
		AUTH_IDENTITY_REPOSITORY,
		PASSWORD_RESET_TOKEN_REPOSITORY,
		EMAIL_VERIFICATION_TOKEN_REPOSITORY,
		ADMIN_INVITE_REPOSITORY,
		AUDIT_LOG_REPOSITORY,
		CONSENT_REPOSITORY,
		AUTH_RATE_LIMIT_REPOSITORY,
		AUTH_PORT,
		STORAGE_PORT,
		MEDIA_ASSET_REPOSITORY,
		MEDIA_ROLE_REPOSITORY,
		CONTENT_BLOCK_REPOSITORY,
		SITE_SETTINGS_REPOSITORY,
		REVIEW_REPOSITORY,
		MEDIA_JOB_QUEUE,
		CDN_PURGE,
		YOUTUBE_PORT,
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
