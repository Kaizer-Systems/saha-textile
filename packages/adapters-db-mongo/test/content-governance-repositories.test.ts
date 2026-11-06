import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	AuditLogModel,
	ContentBlockModel,
	FaqEntryModel,
	MediaAssetModel,
	MessageOutboxModel,
	NotificationChannelSettingsModel,
	NotificationTemplateModel,
	OrderModel,
	ProductQuestionModel,
	RatingAggregateModel,
	ReviewModel,
} from '../src/models/index';
import {
	MongoAuditLogRepository,
	MongoContentBlockRepository,
	MongoFaqRepository,
	MongoMediaAssetRepository,
	MongoMessageOutboxRepository,
	MongoNotificationSettingsRepository,
	MongoNotificationTemplateRepository,
	MongoProductQuestionRepository,
	MongoReviewRepository,
} from '../src/repositories/index';
import { MongoTransactionManager } from '../src/transaction-manager';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

const P = runPrefix('content');
const at = '2026-11-06T00:00:00.000Z';
const future = '2099-01-01T00:00:00.000Z';
const past = '2000-01-01T00:00:00.000Z';
const date = new Date(at);

describe.skipIf(!hasMongoEnv())('governance, content and media repositories (integration, rs0)', () => {
	beforeAll(async () => {
		await connectMongo();
		await Promise.all([
			NotificationChannelSettingsModel.syncIndexes(),
			MessageOutboxModel.syncIndexes(),
			ContentBlockModel.syncIndexes(),
		]);
	});

	afterAll(async () => {
		const byId = { _id: { $regex: `^${P}` } };
		await Promise.all([
			AuditLogModel.deleteMany(byId),
			ContentBlockModel.deleteMany(byId),
			FaqEntryModel.deleteMany(byId),
			MediaAssetModel.deleteMany(byId),
			MessageOutboxModel.deleteMany(byId),
			NotificationChannelSettingsModel.deleteMany(byId),
			NotificationTemplateModel.deleteMany(byId),
			OrderModel.deleteMany(byId),
			ProductQuestionModel.deleteMany(byId),
			RatingAggregateModel.deleteMany(byId),
			ReviewModel.deleteMany(byId),
		]);
		await disconnectMongo();
	});

	describe('audit log', () => {
		const repo = new MongoAuditLogRepository();
		const entry = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				actorUserId: `${P}actor`,
				targetUserId: `${P}target`,
				audience: 'admin',
				action: `${P}action`,
				entityType: `${P}type`,
				entityId: `${P}entity`,
				severity: 'info',
				retentionTier: 'financial_security',
				diffs: [{ path: 'a' }],
				metadata: { a: 1 },
				requestId: 'r',
				ipHash: 'i',
				userAgentHash: 'u',
				createdAt: at,
				...overrides,
			}) as never;
		const page = { page: 1, pageSize: 10 };

		it('appends inside a transaction and reads back', async () => {
			await new MongoTransactionManager().withTransaction((context) => repo.append(entry('a1'), context));
			const found = await repo.list({ ...page, actorUserId: `${P}actor` } as never);
			expect(found.items[0]).toMatchObject({ requestId: 'r', metadata: { a: 1 }, createdAt: at });
		});

		it.each([
			['target', { targetUserId: `${P}target` }],
			['action', { action: `${P}action` }],
			['type', { entityType: `${P}type` }],
			['entity', { entityId: `${P}entity` }],
			['severity and audience', { severity: 'info', audience: 'admin', entityId: `${P}entity` }],
			['from', { from: past, entityId: `${P}entity` }],
			['to', { to: future, entityId: `${P}entity` }],
			['both dates', { from: past, to: future, entityId: `${P}entity` }],
		])('filters by %s', async (_label, filter) => {
			expect((await repo.list({ ...page, ...filter } as never)).total).toBe(1);
		});

		it('fills the gaps in a sparse row', async () => {
			await insertRaw(AuditLogModel, { _id: `${P}sparse`, action: `${P}sparse_action`, createdAt: date });
			const found = await repo.list({ ...page, action: `${P}sparse_action` } as never);
			expect(found.items[0]).toMatchObject({
				actorUserId: null,
				targetUserId: null,
				entityType: null,
				entityId: null,
				diffs: [],
				metadata: {},
				requestId: null,
				ipHash: null,
				userAgentHash: null,
			});
		});

		it('purges by tier, and copes with a missing count', async () => {
			await repo.append(
				entry('old', { retentionTier: 'financial_security', createdAt: past, action: `${P}old` }),
			);
			expect(
				await repo.purgeOlderThan({ retentionTier: 'financial_security', before: '2000-06-01T00:00:00.000Z' }),
			).toBeGreaterThanOrEqual(1);
			const spy = vi.spyOn(AuditLogModel, 'deleteMany').mockReturnValue({ exec: async () => ({}) } as never);
			expect(await repo.purgeOlderThan({ retentionTier: 'financial_security', before: past })).toBe(0);
			spy.mockRestore();
		});
	});

	describe('notification settings', () => {
		const repo = new MongoNotificationSettingsRepository();
		const row = { _id: 'n', channel: 'email', category: 'transactional', enabled: true };
		const reading = (doc: unknown) =>
			vi.spyOn(NotificationChannelSettingsModel, 'findOne').mockReturnValue({
				lean: () => ({ exec: async () => doc }),
			} as never);

		it('fills the gaps, and reads a complete row', async () => {
			let spy = reading(row);
			expect(await repo.findSettings('email', 'transactional')).toMatchObject({
				planLimit: null,
				usedThisPeriod: 0,
				warnThresholdPct: 80,
				autoDisableAtLimit: false,
				periodResetAt: null,
				updatedAt: undefined,
			});
			spy.mockRestore();
			spy = reading({
				...row,
				planLimit: 9,
				usedThisPeriod: 3,
				warnThresholdPct: 50,
				autoDisableAtLimit: true,
				periodResetAt: date,
				updatedAt: date,
			});
			expect(await repo.findSettings('email', 'transactional')).toMatchObject({
				planLimit: 9,
				periodResetAt: at,
				updatedAt: at,
			});
			spy.mockRestore();
		});

		it('lists all settings', async () => {
			expect(Array.isArray(await repo.listSettings())).toBe(true);
		});

		it('answers null when none is stored', async () => {
			const spy = reading(null);
			expect(await repo.findSettings('email', 'transactional')).toBeNull();
			spy.mockRestore();
		});

		it('hands back what it was given if the row cannot be read again', async () => {
			const write = vi
				.spyOn(NotificationChannelSettingsModel, 'findOneAndUpdate')
				.mockReturnValue({ exec: async () => null } as never);
			const read = reading(null);
			const settings = { id: 'n', channel: 'email', category: 'transactional', periodResetAt: at } as never;
			expect(await repo.upsertSettings(settings)).toBe(settings);
			const none = { id: 'n', channel: 'email', category: 'transactional', periodResetAt: null } as never;
			expect(await repo.upsertSettings(none)).toBe(none);
			write.mockRestore();
			read.mockRestore();
		});

		it('answers 0 when there is no row to count against', async () => {
			const spy = vi.spyOn(NotificationChannelSettingsModel, 'findOneAndUpdate').mockReturnValue({
				lean: () => ({ exec: async () => null }),
			} as never);
			expect(await repo.incrementUsage({ channel: 'email', category: 'marketing', by: 1 })).toBe(0);
			spy.mockRestore();
		});
	});

	describe('notification templates', () => {
		const repo = new MongoNotificationTemplateRepository();

		it('saves, finds, lists and reads a sparse row', async () => {
			const key = `${P}key`.toLowerCase();
			await repo.upsert({
				id: `${P}t1`,
				key,
				channel: 'email',
				category: 'transactional',
				name: 'n',
				description: 'd',
				dltHeaderId: 'h',
				dltTemplateId: 't',
				whatsappTemplateId: 'w',
				emailSubject: 's',
				emailBody: 'b',
				status: 'approved',
			} as never);
			expect(await repo.findByKey(key)).toMatchObject({
				dltHeaderId: 'h',
				dltTemplateId: 't',
				whatsappTemplateId: 'w',
			});
			expect(await repo.findByKey(`${P}none`)).toBeNull();
			expect((await repo.list()).map((row) => row.key)).toContain(key);
			await insertRaw(NotificationTemplateModel, { _id: `${P}t2`, key: `${P}sparse`, channel: 'email' });
			expect(await repo.findByKey(`${P}sparse`)).toMatchObject({
				dltHeaderId: null,
				dltTemplateId: null,
				whatsappTemplateId: null,
				createdAt: undefined,
				updatedAt: undefined,
			});
			await insertRaw(NotificationTemplateModel, {
				_id: `${P}t3`,
				key: `${P}dated`,
				channel: 'email',
				createdAt: date,
				updatedAt: date,
			});
			expect(await repo.findByKey(`${P}dated`)).toMatchObject({ createdAt: at, updatedAt: at });
		});
	});

	describe('message outbox', () => {
		const repo = new MongoMessageOutboxRepository();
		const entry = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				channel: 'email',
				category: 'transactional',
				templateKey: 'k',
				destinationHash: 'h',
				userId: `${P}user`,
				status: 'queued',
				providerMessageId: null,
				errorMessage: null,
				attempts: 1,
				createdAt: at,
				sentAt: null,
				...overrides,
			}) as never;

		it('appends with and without a key, and finds by the key', async () => {
			await repo.append(entry('m1'));
			await new MongoTransactionManager().withTransaction((context) =>
				repo.append(
					entry('m2', { idempotencyKey: `${P}key`, sentAt: at, providerMessageId: 'p', errorMessage: 'e' }),
					context,
				),
			);
			expect(await repo.findByIdempotencyKey(`${P}key`)).toMatchObject({
				id: `${P}m2`,
				sentAt: at,
				providerMessageId: 'p',
				errorMessage: 'e',
			});
			expect(await repo.findByIdempotencyKey(`${P}none`)).toBeNull();
		});

		it('updates only the fields it is given', async () => {
			await repo.updateStatus({ entryId: `${P}m1`, status: 'failed' });
			await repo.updateStatus({
				entryId: `${P}m1`,
				status: 'sent',
				providerMessageId: 'p',
				errorMessage: null,
				sentAt: at,
			});
			await repo.updateStatus({ entryId: `${P}m2`, status: 'queued', sentAt: null });
			const found = await repo.list({ userId: `${P}user`, status: 'sent' } as never);
			expect(found.items[0]).toMatchObject({ providerMessageId: 'p', sentAt: at, attempts: 3 });
		});

		it.each([
			['channel and category', { channel: 'email', category: 'transactional' }],
			['from', { from: past }],
			['to', { to: future }],
			['both dates', { from: past, to: future, page: 1, pageSize: 5 }],
		])('filters by %s', async (_label, filter) => {
			expect((await repo.list({ userId: `${P}user`, ...filter } as never)).total).toBe(2);
		});

		it('lists every entry when no filter is given', async () => {
			expect(Array.isArray((await repo.list({ pageSize: 1 } as never)).items)).toBe(true);
		});

		it('fills the gaps in a sparse row', async () => {
			await insertRaw(MessageOutboxModel, { _id: `${P}sparse`, idempotencyKey: `${P}sparse`, createdAt: date });
			expect(await repo.findByIdempotencyKey(`${P}sparse`)).toMatchObject({
				userId: null,
				providerMessageId: null,
				errorMessage: null,
				attempts: 0,
				sentAt: null,
			});
		});
	});

	describe('FAQ', () => {
		const repo = new MongoFaqRepository();
		const entry = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				question: { en: 'Q' },
				answer: { en: 'A' },
				scope: 'mixed',
				categoryIds: [`${P}cat`],
				productIds: [`${P}prod`],
				displayOrder: 1,
				status: 'live',
				...overrides,
			}) as never;

		beforeAll(async () => {
			await repo.save(entry('f1'));
			await repo.save(entry('f2', { status: 'draft' }));
		});

		it('finds, and misses a stranger', async () => {
			expect((await repo.findById(`${P}f1`))?.displayOrder).toBe(1);
			expect(await repo.findById(`${P}none`)).toBeNull();
		});

		it('hides drafts from the public list', async () => {
			expect((await repo.list({ audience: 'public', categoryId: `${P}cat` } as never)).total).toBe(1);
			expect(
				(await repo.list({ audience: 'admin', productId: `${P}prod`, page: 1, pageSize: 5 } as never)).total,
			).toBe(2);
			expect(await repo.list({ audience: 'admin', categoryId: `${P}cat` } as never)).toMatchObject({
				page: 1,
				pageSize: 50,
			});
		});

		it('resolves one entry once for a page', async () => {
			const rows = await repo.resolveForSurface({ categoryIds: [`${P}cat`], productId: `${P}prod` });
			expect(rows.filter((row) => row.id === `${P}f1`)).toHaveLength(1);
			expect((await repo.resolveForSurface({})).map((row) => row.id)).not.toContain(`${P}f1`);
			expect((await repo.resolveForSurface({ categoryIds: [] })).map((row) => row.id)).not.toContain(`${P}f1`);
		});

		it('fills the gaps, keeps dates, and deletes', async () => {
			await insertRaw(FaqEntryModel, { _id: `${P}sparse`, scope: 'global', status: 'draft' });
			expect(await repo.findById(`${P}sparse`)).toMatchObject({
				categoryIds: [],
				productIds: [],
				displayOrder: 0,
			});
			await insertRaw(FaqEntryModel, { _id: `${P}dated`, createdAt: date, updatedAt: date });
			expect(await repo.findById(`${P}dated`)).toMatchObject({ createdAt: at, updatedAt: at });
			await repo.deleteById(`${P}dated`);
			expect(await repo.findById(`${P}dated`)).toBeNull();
		});
	});

	describe('product questions', () => {
		const repo = new MongoProductQuestionRepository();
		const question = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				productId: `${P}qprod`,
				question: `Question ${name}`,
				userId: 'u',
				askerName: 'A',
				askerEmail: 'a@example.test',
				isAnonymous: true,
				answer: null,
				answeredByUserId: null,
				answeredAt: null,
				status: 'pending',
				...overrides,
			}) as never;

		it('creates with or without dates, and finds', async () => {
			await repo.create(question('q1'));
			await repo.create(
				question('q2', {
					createdAt: at,
					answeredAt: at,
					status: 'answered',
					answer: 'yes',
					answeredByUserId: 'a',
				}),
			);
			expect(await repo.findById(`${P}q1`)).toMatchObject({ askerEmail: 'a@example.test', isAnonymous: true });
			expect(await repo.findById(`${P}q2`)).toMatchObject({ answeredAt: at, createdAt: at, answer: 'yes' });
			expect(await repo.findById(`${P}none`)).toBeNull();
		});

		it('keeps the email out of the public list', async () => {
			const result = await repo.listAnsweredForProduct(`${P}qprod`, { page: 0, pageSize: 0 } as never);
			expect(result).toMatchObject({ total: 1, page: 1, pageSize: 20 });
			expect(result.items[0]?.askerEmail).toBeUndefined();
			expect(await repo.listAnsweredForProduct(`${P}qprod`, { page: 1, pageSize: 5 } as never)).toMatchObject({
				pageSize: 5,
			});
		});

		it('filters the admin list', async () => {
			expect(
				(await repo.list({ productId: `${P}qprod`, status: 'pending', page: 1, pageSize: 5 } as never)).total,
			).toBe(1);
			expect(await repo.list({ productId: `${P}qprod` } as never)).toMatchObject({
				total: 2,
				page: 1,
				pageSize: 20,
			});
		});

		it('finds a pending duplicate', async () => {
			const input = { productId: `${P}qprod`, askerEmail: 'a@example.test', question: 'Question q1' };
			expect((await repo.findPendingDuplicate(input))?.id).toBe(`${P}q1`);
			expect(await repo.findPendingDuplicate({ ...input, question: 'Other' })).toBeNull();
		});

		it('answers, misses a stranger, and changes status', async () => {
			const input = { answer: 'Yes', answeredByUserId: 'a', answeredAt: at };
			expect((await repo.answer({ questionId: `${P}q1`, ...input }))?.status).toBe('answered');
			expect(await repo.answer({ questionId: `${P}none`, ...input })).toBeNull();
			await repo.updateStatus(`${P}q1`, 'rejected');
			expect((await repo.findById(`${P}q1`))?.status).toBe('rejected');
		});

		it('lists every question when no filter is given', async () => {
			expect(Array.isArray((await repo.list({ pageSize: 1 } as never)).items)).toBe(true);
		});

		it('fills the gaps in a sparse row', async () => {
			await insertRaw(ProductQuestionModel, { _id: `${P}sparse`, productId: 'p', question: 'q' });
			expect(await repo.findById(`${P}sparse`)).toMatchObject({
				userId: null,
				isAnonymous: false,
				answer: null,
				answeredByUserId: null,
				answeredAt: null,
				createdAt: undefined,
			});
		});
	});

	describe('reviews', () => {
		const repo = new MongoReviewRepository();
		const review = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				productId: `${P}rprod`,
				userId: `${P}ruser`,
				orderId: `${P}order_${name}`,
				rating: 4,
				title: 'Good',
				body: 'Body',
				imageAssetIds: ['a'],
				status: 'approved',
				moderatedByUserId: 'm',
				moderatedAt: at,
				moderationNote: 'ok',
				createdAt: at,
				...overrides,
			}) as never;

		it('creates, finds and pages approved reviews', async () => {
			await repo.create(review('r1'));
			await repo.create(review('r2', { rating: 2, status: 'pending', moderatedAt: null, createdAt: undefined }));
			expect(await repo.findById(`${P}r1`)).toMatchObject({
				title: 'Good',
				moderatedAt: at,
				moderationNote: 'ok',
			});
			expect(await repo.findById(`${P}none`)).toBeNull();
			expect(await repo.listApprovedForProduct(`${P}rprod`, {} as never)).toMatchObject({
				total: 1,
				page: 1,
				pageSize: 20,
			});
			expect(await repo.listApprovedForProduct(`${P}rprod`, { page: 1, pageSize: 5 } as never)).toMatchObject({
				pageSize: 5,
			});
		});

		it.each([
			['product', { productId: `${P}rprod` }, 2],
			['user', { userId: `${P}ruser` }, 2],
			['status', { productId: `${P}rprod`, status: 'pending' }, 1],
			['rating', { productId: `${P}rprod`, rating: 2, page: 1, pageSize: 5 }, 1],
		])('filters by %s', async (_label, filter, total) => {
			expect((await repo.list(filter as never)).total).toBe(total);
		});

		it('knows a verified purchase', async () => {
			await insertRaw(OrderModel, {
				_id: `${P}delivered`,
				orderNumber: `${P}delivered`,
				userId: `${P}ruser`,
				status: 'delivered',
				lines: [{ productId: `${P}rprod` }],
			});
			expect(await repo.hasVerifiedPurchase({ userId: `${P}ruser`, productId: `${P}rprod` })).toBe(true);
			expect(await repo.hasVerifiedPurchase({ userId: `${P}ruser`, productId: `${P}other` })).toBe(false);
		});

		it('moderates with and without a note or images, and misses a stranger', async () => {
			const input = { status: 'approved' as const, moderatedByUserId: 'm', moderatedAt: at };
			const noted = await new MongoTransactionManager().withTransaction((context) =>
				repo.moderate({ reviewId: `${P}r2`, ...input, note: 'fine', imageAssetIds: [] }, context),
			);
			expect(noted).toMatchObject({ moderationNote: 'fine', imageAssetIds: [] });
			expect((await repo.moderate({ reviewId: `${P}r2`, ...input }))?.moderationNote).toBeNull();
			expect(await repo.moderate({ reviewId: `${P}none`, ...input })).toBeNull();
		});

		it('recomputes the aggregate from approved reviews', async () => {
			const aggregate = await repo.recomputeAggregate(`${P}rprod`);
			expect(aggregate).toMatchObject({ average: 3, count: 2, buckets: { 2: 1, 4: 1 } });
			expect(await repo.getAggregate(`${P}rprod`)).toMatchObject({ average: 3, count: 2 });
		});

		it('recomputes inside a transaction, and with nothing approved', async () => {
			const aggregate = await new MongoTransactionManager().withTransaction((context) =>
				repo.recomputeAggregate(`${P}empty`, context),
			);
			expect(aggregate).toMatchObject({ average: 0, count: 0 });
		});

		it('reads an aggregate with no date, and misses a stranger', async () => {
			await insertRaw(RatingAggregateModel, { _id: `${P}undated`, average: 5, count: 1, buckets: {} });
			expect((await repo.getAggregate(`${P}undated`))?.updatedAt).toBeUndefined();
			expect(await repo.getAggregate(`${P}none`)).toBeNull();
		});

		it('fills the gaps in a sparse row', async () => {
			await insertRaw(ReviewModel, { _id: `${P}sparse`, productId: 'p', rating: 5 });
			expect(await repo.findById(`${P}sparse`)).toMatchObject({
				title: null,
				imageAssetIds: [],
				moderatedByUserId: null,
				moderatedAt: null,
				moderationNote: null,
				createdAt: undefined,
			});
		});
	});

	describe('content blocks', () => {
		const repo = new MongoContentBlockRepository();
		const block = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				key: `${P}${name}`,
				ownerType: 'category',
				ownerId: `${P}owner`,
				position: 'category_banner',
				slot: 'main',
				images: { desktop: 'd', tablet: null, phone: null },
				containsText: false,
				localeImages: {},
				heading: {},
				subheading: {},
				ctaLabel: {},
				link: null,
				alt: {},
				status: 'active',
				startsAt: null,
				endsAt: null,
				...overrides,
			}) as never;

		beforeAll(async () => {
			await repo.save(block('b1'));
			await repo.save(
				block('b2', { startsAt: past, endsAt: future, images: { desktop: 'd', tablet: 't', phone: 'p' } }),
			);
			await repo.save(block('b3', { startsAt: future }));
			await repo.save(block('b4', { status: 'draft' }));
		});

		it('finds by key', async () => {
			expect(await repo.findByKey(`${P}b2`)).toMatchObject({
				images: { tablet: 't', phone: 'p' },
				startsAt: past,
				endsAt: future,
			});
			expect(await repo.findByKey(`${P}none`)).toBeNull();
		});

		it('filters the list', async () => {
			expect(await repo.list({ ownerType: 'category', ownerId: `${P}owner` })).toHaveLength(4);
			expect(
				await repo.list({ ownerId: `${P}owner`, position: 'category_banner', status: 'draft' }),
			).toHaveLength(1);
			expect(Array.isArray(await repo.list({}))).toBe(true);
		});

		it('lists what is live now', async () => {
			const live = await repo.listLive({ ownerType: 'category', ownerId: `${P}owner`, now: at });
			expect(live.map((row) => row.id)).toEqual([`${P}b1`, `${P}b2`]);
		});

		it('fills the gaps in a sparse row, keeps a complete one, and deletes', async () => {
			await insertRaw(ContentBlockModel, { _id: `${P}sparse`, key: `${P}sparse`, images: { desktop: 'd' } });
			expect(await repo.findByKey(`${P}sparse`)).toMatchObject({
				ownerId: null,
				images: { tablet: null, phone: null },
				localeImages: {},
				heading: {},
				subheading: {},
				ctaLabel: {},
				link: null,
				alt: {},
				createdAt: undefined,
				updatedAt: undefined,
			});
			await insertRaw(ContentBlockModel, {
				_id: `${P}full`,
				key: `${P}full`,
				images: { desktop: 'd' },
				localeImages: { fr: {} },
				heading: { en: 'H' },
				subheading: { en: 'S' },
				ctaLabel: { en: 'C' },
				link: { kind: 'path' },
				alt: { en: 'A' },
				createdAt: date,
				updatedAt: date,
			});
			expect(await repo.findByKey(`${P}full`)).toMatchObject({
				createdAt: at,
				updatedAt: at,
				heading: { en: 'H' },
			});
			await repo.deleteByKey(`${P}full`);
			expect(await repo.findByKey(`${P}full`)).toBeNull();
		});
	});

	describe('media assets', () => {
		const repo = new MongoMediaAssetRepository();
		const asset = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				kind: 'image',
				purpose: 'product',
				originalStorageKey: `${P}${name}/original.jpg`,
				originalFormat: 'image/jpeg',
				originalByteSize: 1,
				width: 10,
				height: 20,
				slug: `${P}${name}`.toLowerCase(),
				derivatives: [],
				dominantColor: '#000000',
				thumbHash: 'h',
				visibility: 'public',
				processing: { state: 'queued', attempts: 0, error: null, processedAt: null },
				warnings: [],
				servesAsPrimary: true,
				maxDisplayWidth: 100,
				renditions: [],
				hlsPlaylistKey: null,
				durationSeconds: null,
				text: { alt: { en: `${P}alt` }, title: {}, caption: {} },
				status: 'draft',
				uploadedBy: { type: 'admin', id: 'a' },
				deletedAt: null,
				...overrides,
			}) as never;

		beforeAll(async () => {
			await repo.create(asset('m1'));
			await repo.create(
				asset('m2', {
					kind: 'video',
					originalFormat: 'video/mp4',
					purpose: 'banner',
					status: 'live',
					processing: { state: 'ready', attempts: 1, error: 'e', processedAt: at },
					deletedAt: at,
					hlsPlaylistKey: 'p',
					durationSeconds: 5,
				}),
			);
		});

		it('finds one and many', async () => {
			expect(await repo.findById(`${P}m2`)).toMatchObject({
				deletedAt: at,
				hlsPlaylistKey: 'p',
				durationSeconds: 5,
				processing: { processedAt: at, error: 'e', attempts: 1 },
			});
			expect(await repo.findById(`${P}none`)).toBeNull();
			expect(await repo.findManyByIds([`${P}m1`, `${P}m2`])).toHaveLength(2);
		});

		it('hides soft-deleted assets unless asked', async () => {
			const search = { search: P };
			expect((await repo.list({ ...search } as never)).total).toBe(1);
			expect((await repo.list({ ...search, includeDeleted: true, page: 1, pageSize: 5 } as never)).total).toBe(2);
			expect(await repo.list({ ...search } as never)).toMatchObject({ page: 1, pageSize: 24 });
		});

		it('filters by kind, status and purpose', async () => {
			const filter = { search: P, includeDeleted: true };
			expect((await repo.list({ ...filter, kind: 'video' } as never)).total).toBe(1);
			expect((await repo.list({ ...filter, status: 'live' } as never)).total).toBe(1);
			expect((await repo.list({ ...filter, purpose: 'banner' } as never)).total).toBe(1);
			expect(Array.isArray((await repo.list({ kind: 'image' } as never)).items)).toBe(true);
		});

		it('updates, and counts no references', async () => {
			await repo.update(asset('m1', { slug: `${P}renamed`.toLowerCase() }));
			expect((await repo.findById(`${P}m1`))?.slug).toBe(`${P}renamed`.toLowerCase());
			expect(await repo.countReferences(`${P}m1`)).toBe(0);
		});

		it('claims once, unless a ready asset may be reprocessed', async () => {
			expect((await repo.claimForProcessing(`${P}m1`))?.processing.state).toBe('processing');
			expect(await repo.claimForProcessing(`${P}m1`)).toBeNull();
			await repo.update(
				asset('m1', { processing: { state: 'ready', attempts: 1, error: null, processedAt: null } }),
			);
			expect(await repo.claimForProcessing(`${P}m1`)).toBeNull();
			expect((await repo.claimForProcessing(`${P}m1`, { allowReady: true }))?.processing.state).toBe(
				'processing',
			);
		});

		it('lists stale derivatives', async () => {
			await repo.update(
				asset('m1', {
					derivatives: [
						{
							role: `${P}role`,
							storageKey: 'k',
							width: 1,
							height: 1,
							byteSize: 1,
							format: 'image/webp',
							roleVersion: 1,
						},
					],
				}),
			);
			const rows = await repo.listStaleForRole({ role: `${P}role`, version: 2, limit: 5 });
			expect(rows.map((row) => row.id)).toEqual([`${P}m1`]);
		});

		it('walks the garbage collection lists', async () => {
			const live = await repo.listLiveCreatedBefore({ createdBefore: future, afterId: null, limit: 100_000 });
			expect(live.map((row) => row.id)).toContain(`${P}m1`);
			const after = await repo.listLiveCreatedBefore({
				createdBefore: future,
				afterId: `${P}m1`,
				limit: 100_000,
			});
			expect(after.map((row) => row.id)).not.toContain(`${P}m1`);
			const orphans = await repo.listOrphans({ deletedBefore: future, limit: 100_000 });
			expect(orphans.map((row) => row.id)).toContain(`${P}m2`);
		});

		it('soft deletes, restores and hard deletes', async () => {
			await repo.softDelete(`${P}m1`, at);
			expect((await repo.findById(`${P}m1`))?.deletedAt).toBe(at);
			await repo.restore(`${P}m1`);
			expect((await repo.findById(`${P}m1`))?.deletedAt).toBeNull();
			await repo.hardDelete(`${P}m1`);
			expect(await repo.findById(`${P}m1`)).toBeNull();
		});

		it('fills the gaps in a sparse row', async () => {
			await insertRaw(MediaAssetModel, { _id: `${P}sparse`, kind: 'image' });
			expect(await repo.findById(`${P}sparse`)).toMatchObject({
				purpose: 'product',
				originalStorageKey: null,
				width: null,
				height: null,
				slug: 'image',
				derivatives: [],
				dominantColor: null,
				thumbHash: null,
				visibility: 'public',
				processing: { state: 'awaiting_upload', attempts: 0, error: null, processedAt: null },
				warnings: [],
				servesAsPrimary: false,
				maxDisplayWidth: null,
				renditions: [],
				hlsPlaylistKey: null,
				durationSeconds: null,
				text: { alt: {}, title: {}, caption: {} },
				uploadedBy: null,
				deletedAt: null,
				createdAt: undefined,
				updatedAt: undefined,
			});
		});
	});
});
