import { CatalogStatus, FaqScope, QuestionStatus, ReviewStatus } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

/** Admin-authored FAQ (`faqEntries`). */
export interface FaqEntryDoc {
	_id: string;
	question: Record<string, string>;
	answer: Record<string, string>;
	scope: string;
	categoryIds: string[];
	productIds: string[];
	displayOrder: number;
	status: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const FaqEntrySchema = new Schema<FaqEntryDoc>(
	{
		_id: { type: String, required: true },
		question: { type: Schema.Types.Mixed, required: true },
		answer: { type: Schema.Types.Mixed, required: true },
		scope: { type: String, enum: FaqScope.options, required: true },
		categoryIds: { type: [String], default: [] },
		productIds: { type: [String], default: [] },
		displayOrder: { type: Number, default: 0 },
		status: { type: String, enum: CatalogStatus.options, default: 'draft' },
	},
	{ collection: 'faqEntries', timestamps: true },
);

/** Resolving a page's FAQ set hits these three lookups. */
FaqEntrySchema.index({ scope: 1, status: 1, displayOrder: 1 });
FaqEntrySchema.index({ categoryIds: 1, status: 1 });
FaqEntrySchema.index({ productIds: 1, status: 1 });

export const FaqEntryModel: Model<FaqEntryDoc> =
	(models.FaqEntry as Model<FaqEntryDoc>) ?? model<FaqEntryDoc>('FaqEntry', FaqEntrySchema);

/**
 * Product Q&A (`productQuestions`).
 *
 * `askerEmail` is retained for admin but is `select: false`: a public projection must not
 * be able to leak it even by accident, and "stay anonymous" hides the NAME publicly while
 * the admin view keeps it.
 */
export interface ProductQuestionDoc {
	_id: string;
	productId: string;
	question: string;
	userId: string | null;
	askerName: string;
	askerEmail: string;
	isAnonymous: boolean;
	answer: string | null;
	answeredByUserId: string | null;
	answeredAt: Date | null;
	status: string;
	createdAt?: Date;
}

const ProductQuestionSchema = new Schema<ProductQuestionDoc>(
	{
		_id: { type: String, required: true },
		productId: { type: String, required: true },
		question: { type: String, required: true },
		userId: { type: String, default: null },
		askerName: { type: String, required: true },
		askerEmail: { type: String, required: true, select: false },
		isAnonymous: { type: Boolean, default: false },
		answer: { type: String, default: null },
		answeredByUserId: { type: String, default: null },
		answeredAt: { type: Date, default: null },
		status: { type: String, enum: QuestionStatus.options, default: 'pending' },
	},
	{ collection: 'productQuestions', timestamps: { createdAt: true, updatedAt: false } },
);

/** The PDP read: answered questions for one product. */
ProductQuestionSchema.index({ productId: 1, status: 1, createdAt: -1 });
/** The moderation queue. */
ProductQuestionSchema.index({ status: 1, createdAt: 1 });

export const ProductQuestionModel: Model<ProductQuestionDoc> =
	(models.ProductQuestion as Model<ProductQuestionDoc>) ??
	model<ProductQuestionDoc>('ProductQuestion', ProductQuestionSchema);

/** Reviews (`reviews`) — logged-in, verified purchase, moderated before display. */
export interface ReviewDoc {
	_id: string;
	productId: string;
	userId: string;
	orderId: string;
	rating: number;
	title: string | null;
	body: string;
	imageAssetIds: string[];
	status: string;
	moderatedByUserId: string | null;
	moderatedAt: Date | null;
	moderationNote: string | null;
	createdAt?: Date;
}

const ReviewSchema = new Schema<ReviewDoc>(
	{
		_id: { type: String, required: true },
		productId: { type: String, required: true },
		userId: { type: String, required: true },
		orderId: { type: String, required: true },
		rating: { type: Number, required: true, min: 1, max: 5 },
		title: { type: String, default: null },
		body: { type: String, required: true },
		imageAssetIds: { type: [String], default: [] },
		status: { type: String, enum: ReviewStatus.options, default: 'pending' },
		moderatedByUserId: { type: String, default: null },
		moderatedAt: { type: Date, default: null },
		moderationNote: { type: String, default: null },
	},
	{ collection: 'reviews', timestamps: { createdAt: true, updatedAt: false } },
);

/** One review per customer per product per order — no review-bombing your own order. */
ReviewSchema.index({ productId: 1, userId: 1, orderId: 1 }, { unique: true });
/** The PDP read and the aggregate recompute both scan approved reviews of one product. */
ReviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
ReviewSchema.index({ status: 1, createdAt: 1 });

export const ReviewModel: Model<ReviewDoc> =
	(models.Review as Model<ReviewDoc>) ?? model<ReviewDoc>('Review', ReviewSchema);

/** Persisted rating aggregate — recomputed from APPROVED reviews only. */
export interface RatingAggregateDoc {
	_id: string;
	average: number;
	count: number;
	buckets: Record<string, number>;
	updatedAt?: Date;
}

const RatingAggregateSchema = new Schema<RatingAggregateDoc>(
	{
		_id: { type: String, required: true },
		average: { type: Number, default: 0 },
		count: { type: Number, default: 0 },
		buckets: { type: Schema.Types.Mixed, default: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
	},
	{ collection: 'ratingAggregates', timestamps: { createdAt: false, updatedAt: true } },
);

export const RatingAggregateModel: Model<RatingAggregateDoc> =
	(models.RatingAggregate as Model<RatingAggregateDoc>) ??
	model<RatingAggregateDoc>('RatingAggregate', RatingAggregateSchema);
