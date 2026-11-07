import { CcavenuePaymentGateway } from '@saha-textile/adapters-payments';
import type { PaymentGatewayPort } from '@saha-textile/core-domain';

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
