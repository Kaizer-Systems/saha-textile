import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';

import { localized } from './catalog-locale';
import { randomUUID } from 'node:crypto';

import {
	ProductQuestion,
	toPublicQuestion,
	type AdminQuestionListQuery,
	type AdminQuestionListResponse,
	type FaqEntry,
} from '@saha-textile/contracts';
import type {
	AuditLogRepository,
	FaqRepository,
	NotificationPort,
	ProductQuestionRepository,
	ProductRepository,
} from '@saha-textile/core-domain';

import {
	AUDIT_LOG_REPOSITORY,
	FAQ_REPOSITORY,
	NOTIFICATION_PORT,
	PRODUCT_QUESTION_REPOSITORY,
	PRODUCT_REPOSITORY,
} from '../infra/tokens';

@Injectable()
export class ContentService {
	constructor(
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Optional() @Inject(FAQ_REPOSITORY) private readonly faqs: FaqRepository | null = null,
		@Optional()
		@Inject(PRODUCT_QUESTION_REPOSITORY)
		private readonly questions: ProductQuestionRepository | null = null,
		@Optional() @Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort | null = null,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
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

	async saveFaq(entry: FaqEntry, actorUserId: string | null) {
		if (!this.faqs) throw new NotFoundException('FAQ is unavailable');
		const saved = await this.faqs.save(entry);
		await this.record(actorUserId, 'catalog.faq.save', saved.id, { scope: saved.scope, status: saved.status });
		return saved;
	}

	async removeFaq(id: string, actorUserId: string | null): Promise<void> {
		if (!this.faqs) throw new NotFoundException('FAQ is unavailable');
		await this.faqs.deleteById(id);
		await this.record(actorUserId, 'catalog.faq.remove', id, {});
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
		const product = await this.products.findBySlug(body.productSlug, 'public');
		if (!product) throw new NotFoundException('Product not found');
		// A double submit answers with the first row instead of writing a second.
		const repeat = await this.questions.findPendingDuplicate({
			productId: product.id,
			askerEmail: body.askerEmail,
			question: body.question,
		});
		if (repeat) return { id: repeat.id, status: 'pending' as const };
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

	/** The moderation list: one status tab, optional words, newest first, with each product's name. */
	async adminQuestions(query: AdminQuestionListQuery): Promise<AdminQuestionListResponse> {
		const page = await this.questions?.list({
			status: query.status,
			search: query.search || undefined,
			page: query.page,
			pageSize: query.pageSize,
		});
		if (!page) return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
		const ids = [...new Set(page.items.map((item) => item.productId))];
		const products = new Map(
			(await Promise.all(ids.map((id) => this.products.findById(id, 'admin')))).flatMap((product) =>
				product ? [[product.id, product] as const] : [],
			),
		);
		return {
			items: page.items.map((question) => {
				const product = products.get(question.productId);
				return {
					question,
					productName: product ? localized(product.title) : null,
					productSlug: product?.slug ?? null,
				};
			}),
			total: page.total,
			page: page.page,
			pageSize: page.pageSize,
		};
	}

	/** Hides a question for good; it stays on record for the admin. */
	async reject(questionId: string, actorUserId: string | null): Promise<{ id: string; status: 'rejected' }> {
		const { repo, question } = await this.requireQuestion(questionId);
		await repo.updateStatus(question.id, 'rejected');
		await this.record(actorUserId, 'catalog.question.reject', question.id, { productId: question.productId });
		return { id: question.id, status: 'rejected' };
	}

	async removeQuestion(questionId: string, actorUserId: string | null): Promise<void> {
		const { repo, question } = await this.requireQuestion(questionId);
		await repo.deleteById(question.id);
		await this.record(actorUserId, 'catalog.question.remove', question.id, { productId: question.productId });
	}

	private async requireQuestion(questionId: string) {
		const repo = this.questions;
		const question = repo ? await repo.findById(questionId) : null;
		if (!repo || !question) throw new NotFoundException('Question not found');
		return { repo, question };
	}

	async answer(questionId: string, answer: string, actorUserId: string | null) {
		if (!this.questions) throw new NotFoundException('Questions are unavailable');
		if (!actorUserId) throw new NotFoundException('Sign in to answer');
		// Only the first answer emails the asker; correcting an answer later stays quiet.
		const firstAnswer = (await this.questions.findById(questionId))?.status !== 'answered';
		const saved = await this.questions.answer({
			questionId,
			answer,
			answeredByUserId: actorUserId,
			answeredAt: new Date().toISOString(),
		});
		if (!saved) throw new NotFoundException('Question not found');
		await this.record(actorUserId, 'catalog.question.answer', saved.id, { productId: saved.productId });
		let emailStatus: 'sent' | 'not_sent' = 'not_sent';
		if (this.notifications && firstAnswer) {
			try {
				await this.notifications.send({
					channel: 'email',
					category: 'transactional',
					templateKey: 'product_question_answered',
					destination: saved.askerEmail,
					userId: saved.userId ?? undefined,
					idempotencyKey: `question-answer:${saved.id}`,
					variables: { questionId: saved.id, productSlug: await this.slugOf(saved.productId) },
				});
				emailStatus = 'sent';
			} catch {
				emailStatus = 'not_sent';
			}
		}
		return { id: saved.id, status: saved.status, emailStatus };
	}

	private async slugOf(productId: string): Promise<string> {
		return (await this.products.findById(productId, 'admin'))?.slug ?? '';
	}

	private async record(
		actorUserId: string | null,
		action: string,
		entityId: string,
		metadata: Record<string, unknown>,
	): Promise<void> {
		await this.audit?.append({
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'catalog',
			entityId,
			severity: 'info',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		});
	}
}
