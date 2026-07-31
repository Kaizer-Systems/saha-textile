import type {
	AuditLog,
	AuditLogListQuery,
	ConsentEvent,
	MessageOutboxEntry,
	NotificationCategory,
	NotificationChannel,
	NotificationChannelSettings,
	NotificationTemplate,
} from '@saha-textile/contracts';

import type { PageQuery, Paginated } from './pagination';
import type { TransactionContext } from './transaction-manager.port';

/**
 * Audit trail (`auditLogs`).
 *
 * Append-only at the application level — there is no update or delete, because an audit
 * record that can be edited is not evidence. Deletion happens only through the retention
 * job, by tier (financial/security 7 years, catalog/admin 5).
 *
 * `append` takes a transaction context so an admin mutation and its audit row commit
 * together: a change that succeeded without its audit entry would be a silent gap.
 */
export interface AuditLogRepository {
	append(entry: AuditLog, context?: TransactionContext): Promise<AuditLog>;
	list(query: AuditLogListQuery): Promise<Paginated<AuditLog>>;
	/** Retention job: removes rows of one tier older than the cutoff. */
	purgeOlderThan(input: { retentionTier: AuditLog['retentionTier']; before: string }): Promise<number>;
}

/**
 * Consent history (`consentEvents`) — append-only; the latest event per subject is the
 * effective consent. A guest is identified by a hashed guest id, so consent survives
 * login and can be attributed once the guest becomes a user.
 */
export interface ConsentRepository {
	findLatestForUser(userId: string): Promise<ConsentEvent | null>;
	findLatestForGuest(guestIdHash: string): Promise<ConsentEvent | null>;
	append(event: ConsentEvent, context?: TransactionContext): Promise<ConsentEvent>;
	/** Privacy export: the full consent history for one subject. */
	listForUser(userId: string, page: PageQuery): Promise<Paginated<ConsentEvent>>;
}

/**
 * Notification configuration and delivery record.
 *
 * Settings live in the DB rather than env because they are admin/RBAC controlled and
 * audited; they contain NO provider secrets (those stay in API env). The outbox is what
 * makes a send idempotent and auditable — `findByIdempotencyKey` lets a retried request
 * return the original result instead of sending twice.
 */
export interface NotificationSettingsRepository {
	findSettings(
		channel: NotificationChannel,
		category: NotificationCategory,
	): Promise<NotificationChannelSettings | null>;
	listSettings(): Promise<NotificationChannelSettings[]>;
	upsertSettings(settings: NotificationChannelSettings): Promise<NotificationChannelSettings>;
	/** Atomically adds to the period counter and returns the new usage. */
	incrementUsage(input: {
		channel: NotificationChannel;
		category: NotificationCategory;
		by: number;
	}): Promise<number>;
}

export interface NotificationTemplateRepository {
	findByKey(key: string): Promise<NotificationTemplate | null>;
	list(): Promise<NotificationTemplate[]>;
	upsert(template: NotificationTemplate): Promise<NotificationTemplate>;
}

export interface MessageOutboxFilter extends PageQuery {
	channel?: NotificationChannel;
	category?: NotificationCategory;
	status?: MessageOutboxEntry['status'];
	userId?: string;
	from?: string;
	to?: string;
}

export interface MessageOutboxRepository {
	append(entry: MessageOutboxEntry, context?: TransactionContext): Promise<MessageOutboxEntry>;
	/** Returns a previous attempt for the same idempotency key, if any. */
	findByIdempotencyKey(key: string): Promise<MessageOutboxEntry | null>;
	updateStatus(input: {
		entryId: string;
		status: MessageOutboxEntry['status'];
		providerMessageId?: string | null;
		errorMessage?: string | null;
		sentAt?: string | null;
	}): Promise<void>;
	list(filter: MessageOutboxFilter): Promise<Paginated<MessageOutboxEntry>>;
}
