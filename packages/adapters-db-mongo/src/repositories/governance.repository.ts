import type {
	AuditLog,
	AuditLogListQuery,
	MessageOutboxEntry,
	NotificationCategory,
	NotificationChannel,
	NotificationChannelSettings,
	NotificationTemplate,
} from '@saha-textile/contracts';
import type {
	AuditLogRepository,
	MessageOutboxFilter,
	MessageOutboxRepository,
	NotificationSettingsRepository,
	NotificationTemplateRepository,
	Paginated,
	TransactionContext,
} from '@saha-textile/core-domain';

import {
	AuditLogModel,
	type AuditLogDoc,
	MessageOutboxModel,
	type MessageOutboxDoc,
	NotificationChannelSettingsModel,
	type NotificationChannelSettingsDoc,
	NotificationTemplateModel,
	type NotificationTemplateDoc,
} from '../models/index';
import { sessionFrom } from '../transaction-manager';

const iso = (value: Date): string => new Date(value).toISOString();
const isoOrNull = (value?: Date | null): string | null => (value ? new Date(value).toISOString() : null);

const toAuditLog = (doc: AuditLogDoc): AuditLog =>
	({
		id: doc._id,
		actorUserId: doc.actorUserId ?? null,
		targetUserId: doc.targetUserId ?? null,
		audience: doc.audience,
		action: doc.action,
		entityType: doc.entityType ?? null,
		entityId: doc.entityId ?? null,
		severity: doc.severity,
		retentionTier: doc.retentionTier,
		diffs: doc.diffs ?? [],
		metadata: doc.metadata ?? {},
		requestId: doc.requestId ?? null,
		ipHash: doc.ipHash ?? null,
		userAgentHash: doc.userAgentHash ?? null,
		createdAt: iso(doc.createdAt),
	}) as AuditLog;

export class MongoAuditLogRepository implements AuditLogRepository {
	/**
	 * Appends an audit row, joining the caller's transaction when there is one.
	 *
	 * That is the point of accepting a context: an admin mutation and its audit record
	 * commit together, so a change can never succeed while its evidence silently fails.
	 */
	async append(entry: AuditLog, context?: TransactionContext): Promise<AuditLog> {
		const { id, createdAt, ...rest } = entry;
		await AuditLogModel.create([{ _id: id, ...rest, createdAt: new Date(createdAt) }], {
			session: sessionFrom(context),
		});
		return entry;
	}

	async list(query: AuditLogListQuery): Promise<Paginated<AuditLog>> {
		const filter: Record<string, unknown> = {};
		if (query.actorUserId) filter.actorUserId = query.actorUserId;
		if (query.targetUserId) filter.targetUserId = query.targetUserId;
		if (query.action) filter.action = query.action;
		if (query.entityType) filter.entityType = query.entityType;
		if (query.entityId) filter.entityId = query.entityId;
		if (query.severity) filter.severity = query.severity;
		if (query.audience) filter.audience = query.audience;
		if (query.from || query.to) {
			filter.createdAt = {
				...(query.from ? { $gte: new Date(query.from) } : {}),
				...(query.to ? { $lte: new Date(query.to) } : {}),
			};
		}

		const [docs, total] = await Promise.all([
			AuditLogModel.find(filter)
				.sort({ createdAt: -1 })
				.skip((query.page - 1) * query.pageSize)
				.limit(query.pageSize)
				.lean<AuditLogDoc[]>()
				.exec(),
			AuditLogModel.countDocuments(filter).exec(),
		]);

		return { items: docs.map(toAuditLog), total, page: query.page, pageSize: query.pageSize };
	}

	/** Retention job: one tier at a time, because the windows differ (7 years vs 5). */
	async purgeOlderThan(input: { retentionTier: AuditLog['retentionTier']; before: string }): Promise<number> {
		const result = await AuditLogModel.deleteMany({
			retentionTier: input.retentionTier,
			createdAt: { $lt: new Date(input.before) },
		}).exec();
		return result.deletedCount ?? 0;
	}
}

const toSettings = (doc: NotificationChannelSettingsDoc): NotificationChannelSettings =>
	({
		id: doc._id,
		channel: doc.channel,
		category: doc.category,
		enabled: doc.enabled,
		planLimit: doc.planLimit ?? null,
		usedThisPeriod: doc.usedThisPeriod ?? 0,
		warnThresholdPct: doc.warnThresholdPct ?? 80,
		autoDisableAtLimit: doc.autoDisableAtLimit ?? false,
		periodResetAt: isoOrNull(doc.periodResetAt),
		updatedAt: doc.updatedAt ? iso(doc.updatedAt) : undefined,
	}) as NotificationChannelSettings;

export class MongoNotificationSettingsRepository implements NotificationSettingsRepository {
	async findSettings(
		channel: NotificationChannel,
		category: NotificationCategory,
	): Promise<NotificationChannelSettings | null> {
		const doc = await NotificationChannelSettingsModel.findOne({ channel, category })
			.lean<NotificationChannelSettingsDoc>()
			.exec();
		return doc ? toSettings(doc) : null;
	}

	async listSettings(): Promise<NotificationChannelSettings[]> {
		const docs = await NotificationChannelSettingsModel.find().lean<NotificationChannelSettingsDoc[]>().exec();
		return docs.map(toSettings);
	}

	async upsertSettings(settings: NotificationChannelSettings): Promise<NotificationChannelSettings> {
		const { id, periodResetAt, updatedAt: _updatedAt, ...rest } = settings;
		await NotificationChannelSettingsModel.findByIdAndUpdate(
			id,
			{ $set: { ...rest, periodResetAt: periodResetAt ? new Date(periodResetAt) : null } },
			{ upsert: true, setDefaultsOnInsert: true },
		).exec();
		return settings;
	}

	/** Atomic: usage decides whether a plan limit has been hit, so it cannot be raced. */
	async incrementUsage(input: {
		channel: NotificationChannel;
		category: NotificationCategory;
		by: number;
	}): Promise<number> {
		const doc = await NotificationChannelSettingsModel.findOneAndUpdate(
			{ channel: input.channel, category: input.category },
			{ $inc: { usedThisPeriod: input.by } },
			{ returnDocument: 'after' },
		)
			.lean<NotificationChannelSettingsDoc>()
			.exec();
		return doc?.usedThisPeriod ?? 0;
	}
}

const toTemplate = (doc: NotificationTemplateDoc): NotificationTemplate =>
	({
		id: doc._id,
		key: doc.key,
		channel: doc.channel,
		category: doc.category,
		name: doc.name,
		description: doc.description,
		dltHeaderId: doc.dltHeaderId ?? null,
		dltTemplateId: doc.dltTemplateId ?? null,
		whatsappTemplateId: doc.whatsappTemplateId ?? null,
		emailSubject: doc.emailSubject,
		emailBody: doc.emailBody,
		status: doc.status,
		createdAt: doc.createdAt ? iso(doc.createdAt) : undefined,
		updatedAt: doc.updatedAt ? iso(doc.updatedAt) : undefined,
	}) as NotificationTemplate;

export class MongoNotificationTemplateRepository implements NotificationTemplateRepository {
	async findByKey(key: string): Promise<NotificationTemplate | null> {
		const doc = await NotificationTemplateModel.findOne({ key }).lean<NotificationTemplateDoc>().exec();
		return doc ? toTemplate(doc) : null;
	}

	async list(): Promise<NotificationTemplate[]> {
		const docs = await NotificationTemplateModel.find().sort({ key: 1 }).lean<NotificationTemplateDoc[]>().exec();
		return docs.map(toTemplate);
	}

	async upsert(template: NotificationTemplate): Promise<NotificationTemplate> {
		const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = template;
		await NotificationTemplateModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, setDefaultsOnInsert: true },
		).exec();
		return template;
	}
}

const toOutboxEntry = (doc: MessageOutboxDoc): MessageOutboxEntry =>
	({
		id: doc._id,
		channel: doc.channel,
		category: doc.category,
		templateKey: doc.templateKey,
		destinationHash: doc.destinationHash,
		userId: doc.userId ?? null,
		status: doc.status,
		providerMessageId: doc.providerMessageId ?? null,
		errorMessage: doc.errorMessage ?? null,
		attempts: doc.attempts ?? 0,
		createdAt: iso(doc.createdAt),
		sentAt: isoOrNull(doc.sentAt),
	}) as MessageOutboxEntry;

export class MongoMessageOutboxRepository implements MessageOutboxRepository {
	async append(
		entry: MessageOutboxEntry & { idempotencyKey?: string | null },
		context?: TransactionContext,
	): Promise<MessageOutboxEntry> {
		const { id, createdAt, sentAt, ...rest } = entry;
		await MessageOutboxModel.create(
			[
				{
					_id: id,
					...rest,
					idempotencyKey: entry.idempotencyKey ?? null,
					createdAt: new Date(createdAt),
					sentAt: sentAt ? new Date(sentAt) : null,
				},
			],
			{ session: sessionFrom(context) },
		);
		return entry;
	}

	/**
	 * A previous attempt under the same key, if any.
	 *
	 * This is what makes a retried send safe: the caller returns the recorded result
	 * instead of dispatching a second message — which for an OTP or an order confirmation
	 * is the difference between one message and two.
	 */
	async findByIdempotencyKey(key: string): Promise<MessageOutboxEntry | null> {
		const doc = await MessageOutboxModel.findOne({ idempotencyKey: key }).lean<MessageOutboxDoc>().exec();
		return doc ? toOutboxEntry(doc) : null;
	}

	async updateStatus(input: {
		entryId: string;
		status: MessageOutboxEntry['status'];
		providerMessageId?: string | null;
		errorMessage?: string | null;
		sentAt?: string | null;
	}): Promise<void> {
		await MessageOutboxModel.updateOne(
			{ _id: input.entryId },
			{
				$set: {
					status: input.status,
					...(input.providerMessageId !== undefined ? { providerMessageId: input.providerMessageId } : {}),
					...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
					...(input.sentAt !== undefined ? { sentAt: input.sentAt ? new Date(input.sentAt) : null } : {}),
				},
				$inc: { attempts: 1 },
			},
		).exec();
	}

	async list(filter: MessageOutboxFilter): Promise<Paginated<MessageOutboxEntry>> {
		const query: Record<string, unknown> = {};
		if (filter.channel) query.channel = filter.channel;
		if (filter.category) query.category = filter.category;
		if (filter.status) query.status = filter.status;
		if (filter.userId) query.userId = filter.userId;
		if (filter.from || filter.to) {
			query.createdAt = {
				...(filter.from ? { $gte: new Date(filter.from) } : {}),
				...(filter.to ? { $lte: new Date(filter.to) } : {}),
			};
		}

		const page = filter.page && filter.page > 0 ? filter.page : 1;
		const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 20;

		const [docs, total] = await Promise.all([
			MessageOutboxModel.find(query)
				.sort({ createdAt: -1 })
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<MessageOutboxDoc[]>()
				.exec(),
			MessageOutboxModel.countDocuments(query).exec(),
		]);

		return { items: docs.map(toOutboxEntry), total, page, pageSize };
	}
}
