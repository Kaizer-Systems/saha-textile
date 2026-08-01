import type { FaqEntry, ProductQuestion, RatingAggregate, Review } from '@saha-textile/contracts';
import type {
	FaqFilter,
	FaqRepository,
	PageQuery,
	Paginated,
	ProductQuestionRepository,
	QuestionFilter,
	ReviewFilter,
	ReviewRepository,
	TransactionContext,
} from '@saha-textile/core-domain';

import {
	FaqEntryModel,
	type FaqEntryDoc,
	OrderModel,
	ProductQuestionModel,
	type ProductQuestionDoc,
	RatingAggregateModel,
	type RatingAggregateDoc,
	ReviewModel,
	type ReviewDoc,
} from '../models/index';
import { sessionFrom } from '../transaction-manager';

const iso = (value?: Date): string | undefined => (value ? new Date(value).toISOString() : undefined);
const isoOrNull = (value?: Date | null): string | null => (value ? new Date(value).toISOString() : null);

const toFaq = (doc: FaqEntryDoc): FaqEntry =>
	({
		id: doc._id,
		question: doc.question,
		answer: doc.answer,
		scope: doc.scope,
		categoryIds: doc.categoryIds ?? [],
		productIds: doc.productIds ?? [],
		displayOrder: doc.displayOrder ?? 0,
		status: doc.status,
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	}) as FaqEntry;

export class MongoFaqRepository implements FaqRepository {
	async findById(faqId: string): Promise<FaqEntry | null> {
		const doc = await FaqEntryModel.findById(faqId).lean<FaqEntryDoc>().exec();
		return doc ? toFaq(doc) : null;
	}

	async list(filter: FaqFilter): Promise<Paginated<FaqEntry>> {
		const query: Record<string, unknown> = {};
		if (filter.audience !== 'admin') query.status = 'live';
		if (filter.categoryId) query.categoryIds = filter.categoryId;
		if (filter.productId) query.productIds = filter.productId;

		const page = filter.page && filter.page > 0 ? filter.page : 1;
		const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 50;

		const [docs, total] = await Promise.all([
			FaqEntryModel.find(query)
				.sort({ displayOrder: 1 })
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<FaqEntryDoc[]>()
				.exec(),
			FaqEntryModel.countDocuments(query).exec(),
		]);

		return { items: docs.map(toFaq), total, page, pageSize };
	}

	/**
	 * Everything that should appear on one page: global entries plus those targeting this
	 * page's categories or product.
	 *
	 * DEDUPED by id, because an entry with `mixed` scope can match through both its category
	 * and its product target and would otherwise render twice on the same page.
	 */
	async resolveForSurface(input: { categoryIds?: readonly string[]; productId?: string }): Promise<FaqEntry[]> {
		const or: Array<Record<string, unknown>> = [{ scope: 'global' }];
		if (input.categoryIds?.length) or.push({ categoryIds: { $in: [...input.categoryIds] } });
		if (input.productId) or.push({ productIds: input.productId });

		const docs = await FaqEntryModel.find({ status: 'live', $or: or })
			.sort({ displayOrder: 1 })
			.lean<FaqEntryDoc[]>()
			.exec();

		const seen = new Set<string>();
		return docs
			.filter((doc) => {
				if (seen.has(doc._id)) return false;
				seen.add(doc._id);
				return true;
			})
			.map(toFaq);
	}

	async save(entry: FaqEntry): Promise<FaqEntry> {
		const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = entry;
		await FaqEntryModel.findByIdAndUpdate(id, { $set: rest }, { upsert: true, setDefaultsOnInsert: true }).exec();
		return entry;
	}

	async deleteById(faqId: string): Promise<void> {
		await FaqEntryModel.deleteOne({ _id: faqId }).exec();
	}
}

const toQuestion = (doc: ProductQuestionDoc): ProductQuestion =>
	({
		id: doc._id,
		productId: doc.productId,
		question: doc.question,
		userId: doc.userId ?? null,
		askerName: doc.askerName,
		// Only present when the caller explicitly selected it (admin paths).
		askerEmail: doc.askerEmail,
		isAnonymous: doc.isAnonymous ?? false,
		answer: doc.answer ?? null,
		answeredByUserId: doc.answeredByUserId ?? null,
		answeredAt: isoOrNull(doc.answeredAt),
		status: doc.status,
		createdAt: iso(doc.createdAt),
	}) as ProductQuestion;

export class MongoProductQuestionRepository implements ProductQuestionRepository {
	async findById(questionId: string): Promise<ProductQuestion | null> {
		const doc = await ProductQuestionModel.findById(questionId)
			.select('+askerEmail')
			.lean<ProductQuestionDoc>()
			.exec();
		return doc ? toQuestion(doc) : null;
	}

	/**
	 * The PDP read. Deliberately does NOT select `askerEmail`: the public path should not
	 * even load the address, so no projection mistake downstream can expose it.
	 */
	async listAnsweredForProduct(productId: string, page: PageQuery): Promise<Paginated<ProductQuestion>> {
		const query = { productId, status: 'answered' };
		const pageNumber = page.page && page.page > 0 ? page.page : 1;
		const pageSize = page.pageSize && page.pageSize > 0 ? page.pageSize : 20;

		const [docs, total] = await Promise.all([
			ProductQuestionModel.find(query)
				.sort({ createdAt: -1 })
				.skip((pageNumber - 1) * pageSize)
				.limit(pageSize)
				.lean<ProductQuestionDoc[]>()
				.exec(),
			ProductQuestionModel.countDocuments(query).exec(),
		]);

		return { items: docs.map(toQuestion), total, page: pageNumber, pageSize };
	}

	async list(filter: QuestionFilter): Promise<Paginated<ProductQuestion>> {
		const query: Record<string, unknown> = {};
		if (filter.productId) query.productId = filter.productId;
		if (filter.status) query.status = filter.status;

		const page = filter.page && filter.page > 0 ? filter.page : 1;
		const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 20;

		const [docs, total] = await Promise.all([
			ProductQuestionModel.find(query)
				.select('+askerEmail')
				.sort({ createdAt: -1 })
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<ProductQuestionDoc[]>()
				.exec(),
			ProductQuestionModel.countDocuments(query).exec(),
		]);

		return { items: docs.map(toQuestion), total, page, pageSize };
	}

	async create(question: ProductQuestion): Promise<ProductQuestion> {
		const { id, answeredAt, createdAt, ...rest } = question;
		await ProductQuestionModel.create([
			{
				_id: id,
				...rest,
				answeredAt: answeredAt ? new Date(answeredAt) : null,
				createdAt: createdAt ? new Date(createdAt) : new Date(),
			},
		]);
		return question;
	}

	/** Answering publishes the Q&A; the caller then triggers the answer email. */
	async answer(input: {
		questionId: string;
		answer: string;
		answeredByUserId: string;
		answeredAt: string;
	}): Promise<ProductQuestion | null> {
		const doc = await ProductQuestionModel.findOneAndUpdate(
			{ _id: input.questionId },
			{
				$set: {
					answer: input.answer,
					answeredByUserId: input.answeredByUserId,
					answeredAt: new Date(input.answeredAt),
					status: 'answered',
				},
			},
			{ returnDocument: 'after' },
		)
			.select('+askerEmail')
			.lean<ProductQuestionDoc>()
			.exec();
		return doc ? toQuestion(doc) : null;
	}

	async updateStatus(questionId: string, status: ProductQuestion['status']): Promise<void> {
		await ProductQuestionModel.updateOne({ _id: questionId }, { $set: { status } }).exec();
	}
}

const toReview = (doc: ReviewDoc): Review =>
	({
		id: doc._id,
		productId: doc.productId,
		userId: doc.userId,
		orderId: doc.orderId,
		rating: doc.rating,
		title: doc.title ?? null,
		body: doc.body,
		imageAssetIds: doc.imageAssetIds ?? [],
		status: doc.status,
		moderatedByUserId: doc.moderatedByUserId ?? null,
		moderatedAt: isoOrNull(doc.moderatedAt),
		moderationNote: doc.moderationNote ?? null,
		createdAt: iso(doc.createdAt),
	}) as Review;

export class MongoReviewRepository implements ReviewRepository {
	async findById(reviewId: string): Promise<Review | null> {
		const doc = await ReviewModel.findById(reviewId).lean<ReviewDoc>().exec();
		return doc ? toReview(doc) : null;
	}

	async listApprovedForProduct(productId: string, page: PageQuery): Promise<Paginated<Review>> {
		const query = { productId, status: 'approved' };
		const pageNumber = page.page && page.page > 0 ? page.page : 1;
		const pageSize = page.pageSize && page.pageSize > 0 ? page.pageSize : 20;

		const [docs, total] = await Promise.all([
			ReviewModel.find(query)
				.sort({ createdAt: -1 })
				.skip((pageNumber - 1) * pageSize)
				.limit(pageSize)
				.lean<ReviewDoc[]>()
				.exec(),
			ReviewModel.countDocuments(query).exec(),
		]);

		return { items: docs.map(toReview), total, page: pageNumber, pageSize };
	}

	async list(filter: ReviewFilter): Promise<Paginated<Review>> {
		const query: Record<string, unknown> = {};
		if (filter.productId) query.productId = filter.productId;
		if (filter.userId) query.userId = filter.userId;
		if (filter.status) query.status = filter.status;
		if (filter.rating) query.rating = filter.rating;

		const page = filter.page && filter.page > 0 ? filter.page : 1;
		const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 20;

		const [docs, total] = await Promise.all([
			ReviewModel.find(query)
				.sort({ createdAt: -1 })
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<ReviewDoc[]>()
				.exec(),
			ReviewModel.countDocuments(query).exec(),
		]);

		return { items: docs.map(toReview), total, page, pageSize };
	}

	/**
	 * Whether this customer has a DELIVERED order line for this product.
	 *
	 * Backed by the orders collection rather than by trusting a client-supplied order id,
	 * which is what makes "verified purchase" mean something.
	 */
	async hasVerifiedPurchase(input: { userId: string; productId: string }): Promise<boolean> {
		const count = await OrderModel.countDocuments({
			userId: input.userId,
			'lines.productId': input.productId,
			status: { $in: ['delivered', 'completed'] },
		}).exec();
		return count > 0;
	}

	async create(review: Review): Promise<Review> {
		const { id, moderatedAt, createdAt, ...rest } = review;
		await ReviewModel.create([
			{
				_id: id,
				...rest,
				moderatedAt: moderatedAt ? new Date(moderatedAt) : null,
				createdAt: createdAt ? new Date(createdAt) : new Date(),
			},
		]);
		return review;
	}

	async moderate(
		input: {
			reviewId: string;
			status: Review['status'];
			moderatedByUserId: string;
			moderatedAt: string;
			note?: string;
		},
		context?: TransactionContext,
	): Promise<Review | null> {
		const doc = await ReviewModel.findOneAndUpdate(
			{ _id: input.reviewId },
			{
				$set: {
					status: input.status,
					moderatedByUserId: input.moderatedByUserId,
					moderatedAt: new Date(input.moderatedAt),
					moderationNote: input.note ?? null,
				},
			},
			{ returnDocument: 'after', session: sessionFrom(context) },
		)
			.lean<ReviewDoc>()
			.exec();
		return doc ? toReview(doc) : null;
	}

	async getAggregate(productId: string): Promise<RatingAggregate | null> {
		const doc = await RatingAggregateModel.findById(productId).lean<RatingAggregateDoc>().exec();
		if (!doc) return null;
		return {
			productId: doc._id,
			average: doc.average,
			count: doc.count,
			buckets: doc.buckets as RatingAggregate['buckets'],
			updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
		};
	}

	/**
	 * Recomputes from APPROVED reviews only.
	 *
	 * Pending and rejected content must never influence the public rating or its SEO
	 * markup, and this runs in the same transaction as the moderation decision that
	 * triggered it, so the aggregate can never disagree with the reviews behind it.
	 */
	async recomputeAggregate(productId: string, context?: TransactionContext): Promise<RatingAggregate> {
		const session = sessionFrom(context);
		const rows = await ReviewModel.find({ productId, status: 'approved' })
			.select('rating')
			.session(session ?? null)
			.lean<Array<{ rating: number }>>()
			.exec();

		const buckets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
		for (const row of rows) {
			const star = Math.min(5, Math.max(1, Math.round(row.rating))) as 1 | 2 | 3 | 4 | 5;
			buckets[star] += 1;
		}

		const count = rows.length;
		const average = count === 0 ? 0 : Number((rows.reduce((sum, row) => sum + row.rating, 0) / count).toFixed(2));

		await RatingAggregateModel.findByIdAndUpdate(
			productId,
			{ $set: { average, count, buckets } },
			{ upsert: true, setDefaultsOnInsert: true, session },
		).exec();

		return { productId, average, count, buckets, updatedAt: new Date().toISOString() };
	}
}
