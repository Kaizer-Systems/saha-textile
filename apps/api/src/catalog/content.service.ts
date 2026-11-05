import { HttpException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { ProductQuestion, toPublicQuestion, type FaqEntry } from '@saha-textile/contracts';
import type {
	FaqRepository,
	NotificationPort,
	ProductQuestionRepository,
	ProductRepository,
} from '@saha-textile/core-domain';

import { FAQ_REPOSITORY, NOTIFICATION_PORT, PRODUCT_QUESTION_REPOSITORY, PRODUCT_REPOSITORY } from '../infra/tokens';

const hits = new Map<string, number[]>();

function limited(key: string, max = 5, windowMs = 60_000): boolean {
	const now = Date.now();
	const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
	if (recent.length >= max) return true;
	recent.push(now);
	hits.set(key, recent);
	return false;
}

@Injectable()
export class ContentService {
	constructor(
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Optional() @Inject(FAQ_REPOSITORY) private readonly faqs: FaqRepository | null = null,
		@Optional()
		@Inject(PRODUCT_QUESTION_REPOSITORY)
		private readonly questions: ProductQuestionRepository | null = null,
		@Optional() @Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort | null = null,
	) {}

	async publicFaq(input: { productId?: string; categoryId?: string }) {
		if (!this.faqs) return [];
		const rows = await this.faqs.resolveForSurface({
			productId: input.productId,
			categoryIds: input.categoryId ? [input.categoryId] : [],
		});
		return rows.map((row) => ({
			id: row.id,
			question: row.question,
			answer: row.answer,
		}));
	}

	adminFaq() {
		return (
			this.faqs?.list({ audience: 'admin', page: 1, pageSize: 200 }) ??
			Promise.resolve({ items: [], total: 0, page: 1, pageSize: 200 })
		);
	}

	async saveFaq(entry: FaqEntry, _actorUserId: string | null) {
		if (!this.faqs) throw new NotFoundException('FAQ is unavailable');
		return this.faqs.save(entry);
	}

	async publicQuestions(productSlug: string) {
		if (!this.questions || !productSlug) return [];
		const product = await this.products.findBySlug(productSlug, 'public');
		if (!product) return [];
		const page = await this.questions.listAnsweredForProduct(product.id, { page: 1, pageSize: 50 });
		return page.items.map(toPublicQuestion);
	}

	async ask(
		body: { productSlug: string; question: string; askerName: string; askerEmail: string; isAnonymous: boolean },
		userId: string | null,
	) {
		if (!this.questions) throw new NotFoundException('Questions are unavailable');
		if (limited(`question:${body.askerEmail.toLowerCase()}`)) {
			throw new HttpException('Too many questions', 429);
		}
		const product = await this.products.findBySlug(body.productSlug, 'public');
		if (!product) throw new NotFoundException('Product not found');
		const question: ProductQuestion = ProductQuestion.parse({
			id: `q_${randomUUID()}`,
			productId: product.id,
			question: body.question,
			userId,
			askerName: body.askerName,
			askerEmail: body.askerEmail,
			isAnonymous: body.isAnonymous,
			status: 'pending',
		});
		await this.questions.create(question);
		return { id: question.id, status: 'pending' as const };
	}

	async adminQuestions() {
		const page = await this.questions?.list({ page: 1, pageSize: 200 });
		return page ?? { items: [], total: 0, page: 1, pageSize: 200 };
	}

	async answer(questionId: string, answer: string, actorUserId: string | null) {
		if (!this.questions) throw new NotFoundException('Questions are unavailable');
		if (!actorUserId) throw new NotFoundException('Sign in to answer');
		const saved = await this.questions.answer({
			questionId,
			answer,
			answeredByUserId: actorUserId,
			answeredAt: new Date().toISOString(),
		});
		if (!saved) throw new NotFoundException('Question not found');
		let emailStatus: 'sent' | 'not_sent' = 'not_sent';
		if (this.notifications) {
			try {
				await this.notifications.send({
					channel: 'email',
					category: 'transactional',
					templateKey: 'product-question-answered',
					destination: saved.askerEmail,
					userId: saved.userId ?? undefined,
					idempotencyKey: `question-answer:${saved.id}`,
					variables: { questionId: saved.id },
				});
				emailStatus = 'sent';
			} catch {
				emailStatus = 'not_sent';
			}
		}
		return { id: saved.id, status: saved.status, emailStatus };
	}
}
