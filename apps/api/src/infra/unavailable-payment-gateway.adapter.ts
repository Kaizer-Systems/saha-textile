import { ServiceUnavailableException } from '@nestjs/common';
import type { PaymentGateway } from '@saha-textile/contracts';
import type {
	PaymentGatewayPort,
	PaymentIntent,
	PaymentReport,
	RefundRecord,
	RefundResult,
} from '@saha-textile/core-domain';

/**
 * Bound when the gateway has no credentials. Every call answers "not configured" rather than
 * pretending a payment happened. Same honesty rule as the unconfigured storage adapter.
 */
export class UnavailablePaymentGateway implements PaymentGatewayPort {
	private static readonly MESSAGE = 'Online payment is not configured. Set the CCAVENUE_ variables to enable it.';

	constructor(readonly gateway: PaymentGateway) {}

	createPayment(): Promise<PaymentIntent> {
		return UnavailablePaymentGateway.refuse();
	}

	verifyCallback(): Promise<PaymentReport> {
		return UnavailablePaymentGateway.refuse();
	}

	fetchPaymentStatus(): Promise<PaymentReport | null> {
		return UnavailablePaymentGateway.refuse();
	}

	refundPayment(): Promise<RefundResult> {
		return UnavailablePaymentGateway.refuse();
	}

	fetchRefunds(): Promise<RefundRecord[]> {
		return UnavailablePaymentGateway.refuse();
	}

	private static refuse(): Promise<never> {
		return Promise.reject(new ServiceUnavailableException(UnavailablePaymentGateway.MESSAGE));
	}
}
