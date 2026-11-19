import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import {
	type AdminPaymentRouting,
	type AuditLog,
	PaymentRoutingSettings,
	type PaymentRoutingWrite,
} from '@saha-textile/contracts';
import { type AuditLogRepository, type GatewayRouting, type SiteSettingsRepository } from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AUDIT_LOG_REPOSITORY, SITE_SETTINGS_REPOSITORY } from '../infra/tokens';

/**
 * The gateways each adapter is built for. CCAvenue's adapter is built (bound, not yet tried on
 * CCAvenue); Razorpay waits for HDFC's kit and PayPal for its own build (owner OD20).
 */
const BUILT = { ccavenue: true, razorpay: false, paypal: false } as const;

/** What checkout needs to route a payment by currency (core `routePaymentGateway`). */
export function gatewayRoutingOf(settings: PaymentRoutingSettings, homeCurrency = 'INR'): GatewayRouting {
	return {
		activeInrGateway: settings.activeInrGateway,
		foreignGateway: settings.paypalTakesNewPayments ? 'paypal' : null,
		homeCurrency,
	};
}

/**
 * Settings › Payment method (shipping rules brief pay01; owner OD20): the currency decides the
 * gateway. One INR gateway takes new payments at a time; PayPal takes every other currency. A
 * switched-off gateway keeps handling refunds and updates for payments it already took. Keys stay
 * in server settings: this page only says whether they are set.
 */
@Injectable()
export class PaymentRoutingService {
	constructor(
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	async current(): Promise<PaymentRoutingSettings> {
		return PaymentRoutingSettings.parse((await this.settings.get('payments.routing')) ?? {});
	}

	async view(): Promise<AdminPaymentRouting> {
		return {
			settings: await this.current(),
			keysOnServer: {
				ccavenue: Boolean(this.config.payments.ccavenue.merchantId),
				razorpay: false,
				paypal: false,
			},
			built: { ...BUILT },
		};
	}

	async save(input: PaymentRoutingWrite, actor: string | null): Promise<AdminPaymentRouting> {
		const current = await this.current();
		if (input.revision !== current.revision)
			throw new ConflictException({
				code: 'stale_revision',
				updatedBy: current.updatedBy,
				updatedAt: current.updatedAt,
			});
		if (input.activeInrGateway !== null && !BUILT[input.activeInrGateway])
			throw new BadRequestException({
				issues: [
					{ path: 'activeInrGateway', message: 'That gateway is not built yet', code: 'gateway_not_built' },
				],
			});
		const at = new Date().toISOString();
		await this.settings.set('payments.routing', {
			...input,
			revision: current.revision + 1,
			updatedAt: at,
			updatedBy: actor,
		});
		await this.record(actor, {
			activeInrGateway: { from: current.activeInrGateway, to: input.activeInrGateway },
			paypalTakesNewPayments: { from: current.paypalTakesNewPayments, to: input.paypalTakesNewPayments },
			testMode: { from: current.testMode, to: input.testMode },
			popups: { from: current.popups, to: input.popups },
		});
		return this.view();
	}

	private async record(actorUserId: string | null, metadata: Record<string, unknown>) {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action: 'payments.routing.update',
			entityType: 'payments',
			entityId: null,
			severity: 'info',
			retentionTier: 'financial_security',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
	}
}
