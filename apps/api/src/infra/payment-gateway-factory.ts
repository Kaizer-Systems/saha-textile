import { Logger } from '@nestjs/common';
import {
	CcavenuePaymentGateway,
	PAYPAL_OFF_MESSAGES,
	PayPalPaymentGateway,
	parsePayPalConfig,
	type PayPalConfig,
} from '@saha-textile/adapters-payments';
import type { PaymentGatewayPort, PaymentRequestPort } from '@saha-textile/core-domain';

import type { AppConfig } from '../config/app-config';
import { UnavailablePaymentGateway } from './unavailable-payment-gateway.adapter';

/**
 * The one place that names the INR gateway's vendor. Replacing CCAvenue means another adapter
 * here and nothing else. A value the adapter refuses stops the boot, naming the setting.
 */
export function buildInrPaymentGateway(config: AppConfig): PaymentGatewayPort {
	const { ccavenue } = config.payments;
	return ccavenue.configured ? new CcavenuePaymentGateway(ccavenue) : new UnavailablePaymentGateway('ccavenue');
}

/** PayPal's settings as this server reads them: on, or off with the reason (never a key value). */
export function payPalConfigOf(config: AppConfig): PayPalConfig {
	return parsePayPalConfig({ ...config.payments.paypal, deployEnv: config.deployEnv ?? null });
}

/**
 * The PayPal gateway, or null when PayPal is off. A missing key or a PAYPAL_ENV that doesn't fit
 * DEPLOY_ENV (live outside production, sandbox in production) fails closed with one startup line.
 */
export function buildPayPalGateway(config: AppConfig, logger = new Logger('PayPal')): PayPalPaymentGateway | null {
	const paypal = payPalConfigOf(config);
	if (!paypal.configured) {
		if (paypal.reason !== 'keysMissing' || config.deployEnv === 'production')
			logger.warn(PAYPAL_OFF_MESSAGES[paypal.reason]);
		return null;
	}
	return new PayPalPaymentGateway({ config: paypal });
}

/** The gateways that send their own payment requests, by gateway (CCAvenue Quick Invoice, PayPal Invoicing). */
export type PaymentRequestPorts = ReadonlyMap<'ccavenue' | 'paypal', PaymentRequestPort>;

/** PayPal's webhook check; `rawBody` is the request body exactly as received. */
export interface WebhookVerifier {
	verifyWebhook(headers: Readonly<Record<string, string | undefined>>, rawBody: string): Promise<boolean>;
}

/**
 * What the shop checkout and our payment requests go through, built once: the INR gateway when it has
 * its keys (null otherwise), and PayPal when it is on (null when off, with its one startup line).
 */
export interface CheckoutGateways {
	readonly inr: PaymentGatewayPort | null;
	readonly paypal: (PaymentGatewayPort & PaymentRequestPort & WebhookVerifier) | null;
}

export function buildCheckoutGateways(config: AppConfig, inr: PaymentGatewayPort): CheckoutGateways {
	return { inr: inr instanceof UnavailablePaymentGateway ? null : inr, paypal: buildPayPalGateway(config) };
}

/** The gateway that took an attempt, by its name. */
export function gatewayNamed(gateways: CheckoutGateways, id: string): PaymentGatewayPort | null {
	if (gateways.inr?.gateway === id) return gateways.inr;
	if (gateways.paypal?.gateway === id) return gateways.paypal;
	return null;
}

export function buildPaymentRequestPorts(gateways: CheckoutGateways): PaymentRequestPorts {
	const ports = new Map<'ccavenue' | 'paypal', PaymentRequestPort>();
	if (gateways.inr instanceof CcavenuePaymentGateway) ports.set('ccavenue', gateways.inr);
	if (gateways.paypal) ports.set('paypal', gateways.paypal);
	return ports;
}
