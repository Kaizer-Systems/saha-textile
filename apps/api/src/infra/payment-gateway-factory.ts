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

export function buildPaymentRequestPorts(config: AppConfig, inr: PaymentGatewayPort): PaymentRequestPorts {
	const ports = new Map<'ccavenue' | 'paypal', PaymentRequestPort>();
	if (inr instanceof CcavenuePaymentGateway) ports.set('ccavenue', inr);
	const paypal = buildPayPalGateway(config);
	if (paypal) ports.set('paypal', paypal);
	return ports;
}
