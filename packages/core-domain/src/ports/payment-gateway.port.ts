import type { PaymentGateway } from '@saha-textile/contracts';

export interface PaymentIntent {
	id: string;
	redirectUrl?: string;
	raw?: unknown;
}

export interface PaymentVerification {
	ok: boolean;
	orderId: string;
	gateway: PaymentGateway;
	raw?: unknown;
}

export interface CreatePaymentInput {
	orderId: string;
	amount: number;
	currency: string;
	returnUrl: string;
	cancelUrl?: string;
}

/** A single payment gateway (CCAvenue for INR, PayPal for non-INR). */
export interface PaymentGatewayPort {
	readonly gateway: PaymentGateway;
	createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;
	verifyCallback(payload: unknown): Promise<PaymentVerification>;
}
