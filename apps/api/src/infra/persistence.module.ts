import { Global, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { MongoTransactionManager, connectMongo, disconnectMongo } from '@saha-textile/adapters-db-mongo';
import {
	MongoAdminInviteRepository,
	MongoAuthRateLimitRepository,
	MongoAuthSessionRepository,
	MongoAuditLogRepository,
	MongoAuthUserRepository,
	MongoConsentRepository,
	MongoEmailVerificationTokenRepository,
	MongoOAuthStateRepository,
	MongoOtpChallengeRepository,
	MongoPasswordResetTokenRepository,
	MongoRoleRepository,
	MongoUserRoleAssignmentRepository,
} from '@saha-textile/adapters-db-mongo';
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
import { ConsoleNotificationAdapter } from './console-notification.adapter';
import {
	AUTH_PORT,
	CART_REPOSITORY,
	CATEGORY_REPOSITORY,
	CURRENCY_REPOSITORY,
	ORDER_REPOSITORY,
	PRODUCT_REPOSITORY,
	ADMIN_INVITE_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	CONSENT_REPOSITORY,
	AUTH_RATE_LIMIT_REPOSITORY,
	AUTH_SESSION_REPOSITORY,
	AUTH_USER_REPOSITORY,
	ROLE_REPOSITORY,
	USER_ROLE_ASSIGNMENT_REPOSITORY,
	EMAIL_VERIFICATION_TOKEN_REPOSITORY,
	OAUTH_STATE_REPOSITORY,
	NOTIFICATION_PORT,
	OTP_CHALLENGE_REPOSITORY,
	PASSWORD_RESET_TOKEN_REPOSITORY,
	PROMOTION_REPOSITORY,
	TRANSACTION_MANAGER,
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
		// Unit-of-work boundary: multi-document commerce writes commit or roll back together.
		{ provide: TRANSACTION_MANAGER, useClass: MongoTransactionManager },
		// Chunk D auth stores. Credential material lives behind these ports only.
		{ provide: AUTH_SESSION_REPOSITORY, useClass: MongoAuthSessionRepository },
		{ provide: AUTH_USER_REPOSITORY, useClass: MongoAuthUserRepository },
		{ provide: ROLE_REPOSITORY, useClass: MongoRoleRepository },
		{ provide: USER_ROLE_ASSIGNMENT_REPOSITORY, useClass: MongoUserRoleAssignmentRepository },
		{ provide: OTP_CHALLENGE_REPOSITORY, useClass: MongoOtpChallengeRepository },
		{ provide: OAUTH_STATE_REPOSITORY, useClass: MongoOAuthStateRepository },
		{ provide: PASSWORD_RESET_TOKEN_REPOSITORY, useClass: MongoPasswordResetTokenRepository },
		{ provide: EMAIL_VERIFICATION_TOKEN_REPOSITORY, useClass: MongoEmailVerificationTokenRepository },
		{ provide: ADMIN_INVITE_REPOSITORY, useClass: MongoAdminInviteRepository },
		{ provide: AUTH_RATE_LIMIT_REPOSITORY, useClass: MongoAuthRateLimitRepository },
		{ provide: CONSENT_REPOSITORY, useClass: MongoConsentRepository },
		// Owner lock: every admin mutation writes an audit record.
		{ provide: AUDIT_LOG_REPOSITORY, useClass: MongoAuditLogRepository },
		// Stub until approved MSG91 credentials/templates exist (owner lock: ports first).
		{ provide: NOTIFICATION_PORT, useClass: ConsoleNotificationAdapter },
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
		TRANSACTION_MANAGER,
		AUTH_SESSION_REPOSITORY,
		AUTH_USER_REPOSITORY,
		ROLE_REPOSITORY,
		USER_ROLE_ASSIGNMENT_REPOSITORY,
		NOTIFICATION_PORT,
		OTP_CHALLENGE_REPOSITORY,
		OAUTH_STATE_REPOSITORY,
		PASSWORD_RESET_TOKEN_REPOSITORY,
		EMAIL_VERIFICATION_TOKEN_REPOSITORY,
		ADMIN_INVITE_REPOSITORY,
		AUDIT_LOG_REPOSITORY,
		CONSENT_REPOSITORY,
		AUTH_RATE_LIMIT_REPOSITORY,
		CONSENT_REPOSITORY,
		AUDIT_LOG_REPOSITORY,
		NOTIFICATION_PORT,
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
