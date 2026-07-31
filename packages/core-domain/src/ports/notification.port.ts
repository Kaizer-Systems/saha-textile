import type { MessageOutboxStatus, NotificationCategory, NotificationChannel } from '@saha-textile/contracts';

/**
 * One outbound message request.
 *
 * The destination is the RAW address/number because the adapter has to hand it to the
 * provider — but only its hash is ever persisted or logged (owner lock). `templateKey`
 * rather than a body: SMS/WhatsApp bodies live with the provider under DLT/WhatsApp
 * approval, and we store the approved ids.
 */
export interface NotificationMessage {
	channel: NotificationChannel;
	category: NotificationCategory;
	templateKey: string;
	/** Email address or E.164 phone number. Never logged, never persisted raw. */
	destination: string;
	/** Template variables; must not carry secrets, tokens, or full card data. */
	variables?: Record<string, string | number>;
	/** Recipient, when the message belongs to a known account. */
	userId?: string;
	/** Caller-supplied key making a retry safe (OTP resend, order-confirmation replay). */
	idempotencyKey?: string;
}

/**
 * Outcome of a send attempt. A suppressed send is a SUCCESSFUL, expected outcome — not
 * an error — so kill-switches and consent checks never surface as failures to a caller.
 */
export interface NotificationResult {
	status: MessageOutboxStatus;
	/** Provider message id when it was actually dispatched. */
	providerMessageId: string | null;
	/** Outbox row recording this attempt. */
	outboxEntryId: string;
}

/**
 * Customer-messaging boundary (`NotificationPort`).
 *
 * MSG91 is the primary provider for email, SMS, and WhatsApp; Resend/SES/SMTP may exist
 * only as optional EMAIL fallback adapters, never primary. Swapping a provider is an
 * adapter plus DI change — nothing above this interface moves.
 *
 * Behavior every implementation must honour (owner locks):
 *   - a disabled (channel × category) short-circuits BEFORE any provider call and
 *     returns `suppressed_channel_disabled`;
 *   - marketing sends require consent and an approved template, else
 *     `suppressed_no_consent`;
 *   - a reached plan limit returns `suppressed_plan_limit` rather than spending;
 *   - every attempt writes an outbox row with a hashed destination;
 *   - OTP codes are never logged.
 *
 * OTP generation/verification is NOT here: Saha Textile generates, stores, and verifies
 * its own OTPs (no provider OTP widget). This port only delivers the message.
 */
export interface NotificationPort {
	send(message: NotificationMessage): Promise<NotificationResult>;
	/** Whether a (channel × category) is currently enabled — for pre-flight admin checks. */
	isChannelEnabled(channel: NotificationChannel, category: NotificationCategory): Promise<boolean>;
}
