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
	MongoAuthIdentityRepository,
	MongoOtpChallengeRepository,
	MongoPasswordResetTokenRepository,
	MongoRoleRepository,
	MongoTransactionManager,
	MongoAdminUserRoleAssignmentRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import {
	MongoCartRepository,
	MongoCategoryRepository,
	MongoCurrencyRepository,
	MongoOrderRepository,
	MongoProductRepository,
	MongoPromotionRepository,
} from '@saha-textile/adapters-db-mongo';
import { Msg91NotificationAdapter } from '@saha-textile/adapters-notifications-msg91';
import type {
	ConsentRepository,
	MessageOutboxRepository,
	NotificationSettingsRepository,
	NotificationTemplateRepository,
} from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Argon2JwtAuth } from './argon2-jwt.auth';
import { ConsoleNotificationAdapter } from './console-notification.adapter';
import {
	AUTH_PORT,
	CART_REPOSITORY,
	CATEGORY_REPOSITORY,
	CURRENCY_REPOSITORY,
	ORDER_REPOSITORY,
	PRODUCT_REPOSITORY,
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
	AUTH_IDENTITY_REPOSITORY,
	MESSAGE_OUTBOX_REPOSITORY,
	NOTIFICATION_PORT,
	NOTIFICATION_SETTINGS_REPOSITORY,
	NOTIFICATION_TEMPLATE_REPOSITORY,
	OTP_CHALLENGE_REPOSITORY,
	PASSWORD_RESET_TOKEN_REPOSITORY,
	PROMOTION_REPOSITORY,
	TRANSACTION_MANAGER,
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
			provide: NOTIFICATION_PORT,
			useFactory: (
				config: AppConfig,
				settings: NotificationSettingsRepository,
				templates: NotificationTemplateRepository,
				outbox: MessageOutboxRepository,
				consent: ConsentRepository,
			) => {
				const wantMsg91 = config.notifications.provider === 'msg91';
				const authKey = config.notifications.msg91AuthKey;
				if (wantMsg91 && authKey) {
					return new Msg91NotificationAdapter({
						config: {
							authKey,
							senderId: config.notifications.msg91SenderId,
							emailFrom: config.notifications.msg91EmailFrom,
							emailDomain: config.notifications.msg91EmailDomain,
							whatsappNumber: config.notifications.msg91WhatsappNumber,
						},
						settings,
						templates,
						outbox,
						consent,
					});
				}
				if (wantMsg91 && !authKey) {
					Logger.warn(
						'NOTIFICATION_PROVIDER=msg91 but MSG91_AUTH_KEY is empty — falling back to console adapter',
						'Notifications',
					);
				}
				return new ConsoleNotificationAdapter();
			},
			inject: [
				APP_CONFIG,
				NOTIFICATION_SETTINGS_REPOSITORY,
				NOTIFICATION_TEMPLATE_REPOSITORY,
				MESSAGE_OUTBOX_REPOSITORY,
				CONSENT_REPOSITORY,
			],
		},
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
		AUTH_IDENTITY_REPOSITORY,
		PASSWORD_RESET_TOKEN_REPOSITORY,
		EMAIL_VERIFICATION_TOKEN_REPOSITORY,
		ADMIN_INVITE_REPOSITORY,
		AUDIT_LOG_REPOSITORY,
		CONSENT_REPOSITORY,
		AUTH_RATE_LIMIT_REPOSITORY,
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
