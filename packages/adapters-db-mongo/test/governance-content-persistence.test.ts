import { randomUUID } from 'node:crypto';

import { Customer } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { toCustomer, toProduct } from '../src/mappers';
import {
	AuditLogModel,
	CustomerModel,
	FaqEntryModel,
	MessageOutboxModel,
	NotificationChannelSettingsModel,
	ProductQuestionModel,
	RatingAggregateModel,
	ReviewModel,
} from '../src/models/index';
import {
	MongoFaqRepository,
	MongoProductQuestionRepository,
	MongoReviewRepository,
} from '../src/repositories/content.repository';
import {
	MongoAuditLogRepository,
	MongoMessageOutboxRepository,
	MongoNotificationSettingsRepository,
} from '../src/repositories/governance.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

const P = 'it_gov_';
const now = () => new Date().toISOString();

describe.skipIf(!hasMongoEnv())('governance and content persistence (integration, rs0)', () => {
	const audit = new MongoAuditLogRepository();
	const settings = new MongoNotificationSettingsRepository();
	const outbox = new MongoMessageOutboxRepository();
	const faq = new MongoFaqRepository();
	const questions = new MongoProductQuestionRepository();
	const reviews = new MongoReviewRepository();
	const transactions = new MongoTransactionManager();

	beforeAll(async () => {
		await connectMongo();
		await Promise.all([
			AuditLogModel.syncIndexes(),
			NotificationChannelSettingsModel.syncIndexes(),
			MessageOutboxModel.syncIndexes(),
			FaqEntryModel.syncIndexes(),
			ProductQuestionModel.syncIndexes(),
			ReviewModel.syncIndexes(),
		]);
	});

	afterAll(async () => {
		const filter = { _id: new RegExp(`^${P}`) };
		await Promise.all([
			AuditLogModel.deleteMany(filter).exec(),
			NotificationChannelSettingsModel.deleteMany(filter).exec(),
			MessageOutboxModel.deleteMany(filter).exec(),
			FaqEntryModel.deleteMany(filter).exec(),
			ProductQuestionModel.deleteMany(filter).exec(),
			ReviewModel.deleteMany(filter).exec(),
			RatingAggregateModel.deleteMany({ _id: new RegExp(`^${P}`) }).exec(),
			CustomerModel.deleteMany({ email: new RegExp(P) }).exec(),
		]);
		await disconnectMongo();
	});

	describe('audit log', () => {
		const entry = (overrides: Record<string, unknown> = {}) => ({
			id: `${P}audit_${randomUUID()}`,
			actorUserId: `${P}admin`,
			targetUserId: null,
			audience: 'admin' as const,
			action: 'product.status.change',
			entityType: 'product',
			entityId: `${P}prod`,
			severity: 'info' as const,
			retentionTier: 'catalog_admin' as const,
			diffs: [],
			metadata: {},
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: now(),
			...overrides,
		});

		it('commits with the mutation it records, or not at all', async () => {
			const row = entry();

			await expect(
				transactions.withTransaction(async (context) => {
					await audit.append(row, context);
					throw new Error('the mutation failed after its audit row was written');
				}),
			).rejects.toThrow('the mutation failed after its audit row was written');

			// No orphan evidence for a change that never happened.
			expect(await AuditLogModel.countDocuments({ _id: row.id }).exec()).toBe(0);
		});

		it('purges one retention tier without touching the other', async () => {
			const old = new Date(Date.now() - 10 * 365 * 86_400_000).toISOString();
			await audit.append(entry({ retentionTier: 'catalog_admin', createdAt: old }));
			const financial = entry({ retentionTier: 'financial_security', createdAt: old });
			await audit.append(financial);

			const purged = await audit.purgeOlderThan({ retentionTier: 'catalog_admin', before: now() });
			expect(purged).toBeGreaterThanOrEqual(1);
			// The seven-year tier survives a five-year sweep.
			expect(await AuditLogModel.countDocuments({ _id: financial.id }).exec()).toBe(1);
		});
	});

	describe('notification settings and outbox', () => {
		it('keeps exactly one settings row per channel and category', async () => {
			const base = {
				id: `${P}notif_${randomUUID()}`,
				channel: 'sms' as const,
				category: 'marketing' as const,
				enabled: true,
				planLimit: null,
				usedThisPeriod: 0,
				warnThresholdPct: 80,
				autoDisableAtLimit: false,
				periodResetAt: null,
			};
			const first = await settings.upsertSettings(base);
			const second = await settings.upsertSettings({
				...base,
				id: `${P}notif_${randomUUID()}`,
				enabled: false,
			});
			// Identity follows the unique (channel, category) row — a fresh id must not fork it.
			expect(second.id).toBe(first.id);
			expect(second.enabled).toBe(false);
			expect(
				await NotificationChannelSettingsModel.countDocuments({
					channel: 'sms',
					category: 'marketing',
				}).exec(),
			).toBe(1);
		});

		it('increments usage atomically', async () => {
			const id = `${P}notif_${randomUUID()}`;
			await settings.upsertSettings({
				id,
				channel: 'email',
				category: 'transactional',
				enabled: true,
				planLimit: 100,
				usedThisPeriod: 0,
				warnThresholdPct: 80,
				autoDisableAtLimit: false,
				periodResetAt: null,
			});

			const results = await Promise.all(
				Array.from({ length: 5 }, () =>
					settings.incrementUsage({ channel: 'email', category: 'transactional', by: 1 }),
				),
			);
			expect(new Set(results).size).toBe(5);
		});

		it('makes a retried send idempotent', async () => {
			const key = `${P}idem_${randomUUID()}`;
			const row = {
				id: `${P}out_${randomUUID()}`,
				channel: 'email' as const,
				category: 'transactional' as const,
				templateKey: 'otp_login',
				destinationHash: 'sha256:abc',
				userId: null,
				status: 'sent' as const,
				providerMessageId: 'provider_1',
				errorMessage: null,
				attempts: 1,
				createdAt: now(),
				sentAt: now(),
				idempotencyKey: key,
			};
			await outbox.append(row);

			// The second attempt under the same key must be refused by the index…
			await expect(outbox.append({ ...row, id: `${P}out_${randomUUID()}` })).rejects.toThrow();
			// …and the caller can find the original result to return instead.
			expect((await outbox.findByIdempotencyKey(key))?.providerMessageId).toBe('provider_1');
		});

		it('allows many sends with no idempotency key', async () => {
			const row = (id: string) => ({
				id,
				channel: 'email' as const,
				category: 'marketing' as const,
				templateKey: 'promo',
				destinationHash: 'sha256:xyz',
				userId: null,
				status: 'queued' as const,
				providerMessageId: null,
				errorMessage: null,
				attempts: 0,
				createdAt: now(),
				sentAt: null,
			});
			await outbox.append(row(`${P}out_${randomUUID()}`));
			await expect(outbox.append(row(`${P}out_${randomUUID()}`))).resolves.toBeDefined();
		});
	});

	describe('FAQ resolution', () => {
		it('returns a mixed-scope entry once, not twice', async () => {
			const categoryId = `${P}cat_${randomUUID()}`;
			const productId = `${P}prod_${randomUUID()}`;
			const id = `${P}faq_${randomUUID()}`;

			await faq.save({
				id,
				question: { en: 'Q' },
				answer: { en: 'A' },
				scope: 'mixed',
				categoryIds: [categoryId],
				productIds: [productId],
				displayOrder: 0,
				status: 'live',
			});

			// It matches through BOTH targets; dedupe must collapse that to one.
			const resolved = await faq.resolveForSurface({ categoryIds: [categoryId], productId });
			expect(resolved.filter((entry) => entry.id === id)).toHaveLength(1);
		});

		it('excludes non-live entries from resolution', async () => {
			const productId = `${P}prod_${randomUUID()}`;
			await faq.save({
				id: `${P}faq_${randomUUID()}`,
				question: { en: 'Draft' },
				answer: { en: 'A' },
				scope: 'product',
				categoryIds: [],
				productIds: [productId],
				displayOrder: 0,
				status: 'draft',
			});
			expect(await faq.resolveForSurface({ productId })).toHaveLength(0);
		});
	});

	describe('product questions', () => {
		const question = (overrides: Record<string, unknown> = {}) => ({
			id: `${P}q_${randomUUID()}`,
			productId: `${P}prod`,
			question: 'Is the blouse included?',
			userId: null,
			askerName: 'Riya',
			askerEmail: 'riya@example.com',
			isAnonymous: false,
			answer: null,
			answeredByUserId: null,
			answeredAt: null,
			status: 'pending' as const,
			createdAt: now(),
			...overrides,
		});

		it('never loads the asker email on the public read path', async () => {
			const created = question({ status: 'answered', answer: 'Yes', answeredByUserId: `${P}admin` });
			await questions.create(created);

			const page = await questions.listAnsweredForProduct(`${P}prod`, { page: 1, pageSize: 10 });
			const found = page.items.find((item) => item.id === created.id);
			expect(found).toBeDefined();
			// The address is not merely hidden downstream — it is never read.
			expect(found?.askerEmail).toBeUndefined();

			// The admin path does load it.
			expect((await questions.findById(created.id))?.askerEmail).toBe('riya@example.com');
		});

		it('keeps pending questions off the public list', async () => {
			await questions.create(question({ productId: `${P}prod_pending` }));
			const page = await questions.listAnsweredForProduct(`${P}prod_pending`, { page: 1, pageSize: 10 });
			expect(page.total).toBe(0);
		});
	});

	describe('reviews and aggregates', () => {
		const review = (productId: string, rating: number, overrides: Record<string, unknown> = {}) => ({
			id: `${P}rev_${randomUUID()}`,
			productId,
			userId: `${P}user_${randomUUID()}`,
			orderId: `${P}order_${randomUUID()}`,
			rating,
			title: null,
			body: 'Lovely weave.',
			imageAssetIds: [],
			status: 'pending' as const,
			moderatedByUserId: null,
			moderatedAt: null,
			moderationNote: null,
			createdAt: now(),
			...overrides,
		});

		it('recomputes the aggregate from approved reviews only', async () => {
			const productId = `${P}prod_agg_${randomUUID()}`;
			await reviews.create(review(productId, 5, { status: 'approved' }));
			await reviews.create(review(productId, 3, { status: 'approved' }));
			// Pending and rejected content must not move the public rating.
			await reviews.create(review(productId, 1, { status: 'pending' }));
			await reviews.create(review(productId, 1, { status: 'rejected' }));

			const aggregate = await reviews.recomputeAggregate(productId);
			expect(aggregate.count).toBe(2);
			expect(aggregate.average).toBe(4);
			expect(aggregate.buckets[5]).toBe(1);
			expect(aggregate.buckets[3]).toBe(1);
			expect(aggregate.buckets[1]).toBe(0);
		});

		it('moderates and recomputes in one transaction', async () => {
			const productId = `${P}prod_mod_${randomUUID()}`;
			const pending = review(productId, 5);
			await reviews.create(pending);
			await reviews.recomputeAggregate(productId);
			expect((await reviews.getAggregate(productId))?.count).toBe(0);

			await transactions.withTransaction(async (context) => {
				await reviews.moderate(
					{ reviewId: pending.id, status: 'approved', moderatedByUserId: `${P}admin`, moderatedAt: now() },
					context,
				);
				await reviews.recomputeAggregate(productId, context);
			});

			// The aggregate can never disagree with the reviews behind it.
			expect((await reviews.getAggregate(productId))?.count).toBe(1);
		});

		it('rolls an approval back with its failed transaction', async () => {
			const productId = `${P}prod_rb_${randomUUID()}`;
			const pending = review(productId, 4);
			await reviews.create(pending);

			await expect(
				transactions.withTransaction(async (context) => {
					await reviews.moderate(
						{
							reviewId: pending.id,
							status: 'approved',
							moderatedByUserId: `${P}admin`,
							moderatedAt: now(),
						},
						context,
					);
					await reviews.recomputeAggregate(productId, context);
					throw new Error('moderation failed');
				}),
			).rejects.toThrow('moderation failed');

			expect((await reviews.findById(pending.id))?.status).toBe('pending');
			expect(await reviews.getAggregate(productId)).toBeNull();
		});

		it('rejects a second review of the same product on the same order', async () => {
			const productId = `${P}prod_dupe_${randomUUID()}`;
			const first = review(productId, 5);
			await reviews.create(first);
			await expect(reviews.create({ ...first, id: `${P}rev_${randomUUID()}` })).rejects.toThrow();
		});
	});

	describe('mapper response safety', () => {
		it('never maps a password hash into the public customer shape', async () => {
			const customerId = `cus_${randomUUID()}`;
			await CustomerModel.create([
				{
					_id: customerId,
					email: `${P}${customerId}@example.com`,
					tokenVersion: 4,
				},
			]);

			const doc = await CustomerModel.findById(customerId).lean().exec();
			const mapped = toCustomer(doc as never);
			const serialized = JSON.stringify(mapped);

			expect(serialized).not.toContain('passwordHash');
			// Version counters are internal too: they tell an attacker when to retry.
			expect(serialized).not.toContain('tokenVersion');

			// And the result is a valid public contract, not just a stripped object.
			expect(Customer.safeParse(mapped).success).toBe(true);
		});

		it('produces no Mongoose internals in a mapped product', () => {
			const mapped = toProduct({
				_id: `${P}prod_map`,
				type: 'simple',
				sku: 'SKU-1',
				title: { en: 'Saree' },
				slug: 'saree',
				categoryIds: [],
				tags: [],
				basePriceINR: 100,
				media: { gallery: [] },
				attributes: [],
				variations: [],
				addons: [],
				relatedProductIds: [],
				crossSellIds: [],
				upsellIds: [],
				ratingsSummary: { avg: 0, count: 0 },
				status: 'live',
			} as never);

			const serialized = JSON.stringify(mapped);
			expect(serialized).not.toContain('_id');
			expect(serialized).not.toContain('__v');
			expect(mapped.id).toBe(`${P}prod_map`);
		});
	});
});
