import { NotFoundException } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CatalogRateLimit } from '../src/catalog/catalog-rate-limit';
import {
	AdminFaqController,
	AdminQuestionsController,
	FaqController,
	QuestionsController,
} from '../src/catalog/content.controller';
import { ContentService } from '../src/catalog/content.service';

const product = { id: 'prd_1', slug: 'red-saree' };

const build = (overrides: { withAll?: boolean; found?: unknown; repeat?: unknown; saved?: unknown } = {}) => {
	const products = {
		findBySlug: vi.fn(async () => (overrides.found === undefined ? product : overrides.found)),
		findById: vi.fn(async () => (overrides.found === undefined ? product : overrides.found)),
	};
	const faqs = {
		resolveForSurface: vi.fn(async () => [
			{ id: 'f1', question: { en: 'Q' }, answer: { en: 'A' }, status: 'live' },
		]),
		list: vi.fn(async () => ({ items: ['row'], total: 1, page: 1, pageSize: 200 })),
		save: vi.fn(async (entry: unknown) => entry),
		deleteById: vi.fn(async () => {}),
	};
	const saved =
		overrides.saved === undefined
			? { id: 'q1', productId: 'prd_1', askerEmail: 'a@example.test', userId: 'u1', status: 'answered' }
			: overrides.saved;
	const questions = {
		listAnsweredForProduct: vi.fn(async () => ({
			items: [
				{
					id: 'q1',
					productId: 'prd_1',
					question: 'Q?',
					askerName: 'A',
					askerEmail: 'a@example.test',
					isAnonymous: false,
					answer: 'Yes',
					answeredAt: '2026-11-06T00:00:00.000Z',
					status: 'answered',
				},
			],
		})),
		findPendingDuplicate: vi.fn(async () => overrides.repeat ?? null),
		create: vi.fn(async (row: unknown) => row),
		list: vi.fn(async () => ({ items: ['q'], total: 1, page: 1, pageSize: 200 })),
		answer: vi.fn(async () => saved),
	};
	const notifications = { send: vi.fn(async () => ({ status: 'sent' })) };
	const audit = { append: vi.fn(async () => {}) };
	const service =
		overrides.withAll === false
			? new ContentService(products as never)
			: new ContentService(
					products as never,
					faqs as never,
					questions as never,
					notifications as never,
					audit as never,
				);
	return { service, products, faqs, questions, notifications, audit };
};

const entry = { id: 'f1', scope: 'global', status: 'live' } as never;
const ask = {
	productSlug: 'red-saree',
	question: 'Q?',
	askerName: 'A',
	askerEmail: 'a@example.test',
	isAnonymous: false,
};

describe('FAQ', () => {
	it('answers nothing without a store, and refuses a write', async () => {
		const { service } = build({ withAll: false });
		expect(await service.publicFaq({})).toEqual([]);
		expect(await service.adminFaq()).toMatchObject({ items: [], total: 0 });
		await expect(service.saveFaq(entry, 'a')).rejects.toBeInstanceOf(NotFoundException);
		await expect(service.removeFaq('f1', 'a')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('passes the page context and shows only the words', async () => {
		const { service, faqs } = build();
		expect(await service.publicFaq({ productId: 'p', categoryId: 'c' })).toEqual([
			{ id: 'f1', question: { en: 'Q' }, answer: { en: 'A' } },
		]);
		expect(faqs.resolveForSurface).toHaveBeenCalledWith({ productId: 'p', categoryIds: ['c'] });
		await service.publicFaq({});
		expect(faqs.resolveForSurface).toHaveBeenLastCalledWith({ productId: undefined, categoryIds: [] });
	});

	it('audits saves and removals', async () => {
		const { service, audit } = build();
		await service.saveFaq(entry, 'a1');
		await service.removeFaq('f1', null);
		expect(audit.append.mock.calls.map((call: unknown[]) => (call[0] as { action: string }).action)).toEqual([
			'catalog.faq.save',
			'catalog.faq.remove',
		]);
		expect((await service.adminFaq()).items).toEqual(['row']);
	});

	it('works without an audit log', async () => {
		const faqs = { save: vi.fn(async (row: unknown) => row) };
		const service = new ContentService({} as never, faqs as never);
		await expect(service.saveFaq(entry, 'a')).resolves.toBe(entry);
	});
});

describe('product questions', () => {
	it('answers nothing without a store, a slug or a product', async () => {
		expect(await build({ withAll: false }).service.publicQuestions('red-saree')).toEqual([]);
		expect(await build().service.publicQuestions('')).toEqual([]);
		expect(await build({ found: null }).service.publicQuestions('red-saree')).toEqual([]);
	});

	it('hides the asker email', async () => {
		const rows = await build().service.publicQuestions('red-saree');
		expect(JSON.stringify(rows)).not.toContain('a@example.test');
	});

	it('refuses to take a question it cannot store', async () => {
		await expect(build({ withAll: false }).service.ask(ask, null)).rejects.toThrow('Questions are unavailable');
		await expect(build({ found: null }).service.ask(ask, null)).rejects.toThrow('Product not found');
	});

	it('stores a new question, and answers a repeat with the first row', async () => {
		const { service, questions } = build();
		const created = await service.ask(ask, 'u1');
		expect(created.status).toBe('pending');
		expect(questions.create).toHaveBeenCalledTimes(1);
		const repeat = build({ repeat: { id: 'first' } });
		expect(await repeat.service.ask(ask, null)).toEqual({ id: 'first', status: 'pending' });
		expect(repeat.questions.create).not.toHaveBeenCalled();
	});

	it('lists for the admin, with or without a store', async () => {
		expect((await build().service.adminQuestions()).items).toEqual(['q']);
		expect(await build({ withAll: false }).service.adminQuestions()).toMatchObject({ items: [], total: 0 });
	});

	it('refuses an answer it cannot record', async () => {
		await expect(build({ withAll: false }).service.answer('q1', 'Yes', 'a')).rejects.toThrow(
			'Questions are unavailable',
		);
		await expect(build().service.answer('q1', 'Yes', null)).rejects.toThrow('Sign in to answer');
		await expect(build({ saved: null }).service.answer('q1', 'Yes', 'a')).rejects.toThrow('Question not found');
	});

	it('emails the asker once', async () => {
		const { service, notifications, audit } = build();
		expect(await service.answer('q1', 'Yes', 'a')).toEqual({ id: 'q1', status: 'answered', emailStatus: 'sent' });
		expect(notifications.send).toHaveBeenCalledWith(
			expect.objectContaining({
				templateKey: 'product_question_answered',
				userId: 'u1',
				idempotencyKey: 'question-answer:q1',
				variables: { questionId: 'q1', productSlug: 'red-saree' },
			}),
		);
		expect(audit.append).toHaveBeenCalledTimes(1);
	});

	it('still answers when the email fails, the asker is a guest, or the product is gone', async () => {
		const failing = build();
		failing.notifications.send.mockRejectedValue(new Error('no template'));
		expect((await failing.service.answer('q1', 'Yes', 'a')).emailStatus).toBe('not_sent');
		const guest = build({
			found: null,
			saved: { id: 'q1', productId: 'prd_1', askerEmail: 'a@example.test', userId: null, status: 'answered' },
		});
		await guest.service.answer('q1', 'Yes', 'a');
		expect(guest.notifications.send).toHaveBeenCalledWith(
			expect.objectContaining({ userId: undefined, variables: { questionId: 'q1', productSlug: '' } }),
		);
	});

	it('still answers when no notifier is wired in', async () => {
		const questions = { answer: vi.fn(async () => ({ id: 'q1', productId: 'p', status: 'answered' })) };
		const service = new ContentService({} as never, null, questions as never);
		expect((await service.answer('q1', 'Yes', 'a')).emailStatus).toBe('not_sent');
	});
});

describe('content controllers', () => {
	const service = () => ({
		publicFaq: vi.fn(async () => 'faq'),
		adminFaq: vi.fn(async () => 'admin-faq'),
		removeFaq: vi.fn(async () => undefined),
		saveFaq: vi.fn(async (row: unknown) => row),
		publicQuestions: vi.fn(async () => 'questions'),
		ask: vi.fn(async () => 'asked'),
		adminQuestions: vi.fn(async () => 'admin-questions'),
		answer: vi.fn(async () => 'answered'),
	});
	const signedIn = { userId: 'u1' } as never;
	const limits = () => ({ enforce: vi.fn(async () => {}) });

	it('reads FAQ for a page', async () => {
		const content = service();
		expect(await new FaqController(content as never).list('p', 'c')).toBe('faq');
		expect(content.publicFaq).toHaveBeenCalledWith({ productId: 'p', categoryId: 'c' });
	});

	it('passes the actor on admin FAQ work, and mints an id', async () => {
		const content = service();
		const controller = new AdminFaqController(content as never);
		expect(await controller.list()).toBe('admin-faq');
		await controller.remove('f1', signedIn);
		await controller.remove('f1', undefined);
		expect(content.removeFaq).toHaveBeenNthCalledWith(1, 'f1', 'u1');
		expect(content.removeFaq).toHaveBeenNthCalledWith(2, 'f1', null);
		const body = {
			question: { en: 'Q' },
			answer: { en: 'A' },
			scope: 'global',
			categoryIds: [],
			productIds: [],
			status: 'draft',
			displayOrder: 0,
		};
		const fresh = (await controller.save(body as never, undefined)) as unknown as { id: string };
		expect(fresh.id).toMatch(/^faq_/);
		const kept = (await controller.save({ ...body, id: 'faq_1' } as never, signedIn)) as unknown as { id: string };
		expect(kept.id).toBe('faq_1');
	});

	it('rate limits a question by person, or by email for a guest', async () => {
		const content = service();
		const limit = limits();
		const controller = new QuestionsController(content as never, limit as never);
		expect(await controller.list('red-saree')).toBe('questions');
		await controller.list();
		expect(content.publicQuestions).toHaveBeenLastCalledWith('');
		const request = { ip: '1.2.3.4' } as never;
		await controller.ask({ ...ask, askerEmail: 'A@Example.test' } as never, undefined, request);
		expect(limit.enforce).toHaveBeenLastCalledWith('product_question', {
			identifier: 'a@example.test',
			ip: '1.2.3.4',
		});
		expect(content.ask).toHaveBeenLastCalledWith(expect.anything(), null);
		await controller.ask(ask as never, signedIn, request);
		expect(limit.enforce).toHaveBeenLastCalledWith('product_question', { identifier: 'u1', ip: '1.2.3.4' });
		expect(content.ask).toHaveBeenLastCalledWith(expect.anything(), 'u1');
	});

	it('answers as the signed-in admin', async () => {
		const content = service();
		const controller = new AdminQuestionsController(content as never);
		expect(await controller.list()).toBe('admin-questions');
		await controller.answer('q1', { answer: 'Yes' } as never, signedIn);
		await controller.answer('q1', { answer: 'Yes' } as never, undefined);
		expect(content.answer).toHaveBeenNthCalledWith(1, 'q1', 'Yes', 'u1');
		expect(content.answer).toHaveBeenNthCalledWith(2, 'q1', 'Yes', null);
	});
});

describe('CatalogRateLimit', () => {
	it('lets a request through, and answers 429 when the limit is reached', async () => {
		const auth = { consumeRateLimit: vi.fn(async () => ({ allowed: true })) };
		const limit = new CatalogRateLimit(auth as never);
		await expect(limit.enforce('catalog_search', { ip: '1.2.3.4' })).resolves.toBeUndefined();
		auth.consumeRateLimit.mockResolvedValue({ allowed: false });
		const error = await limit.enforce('catalog_search', { ip: '1.2.3.4' }).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(HttpException);
		expect((error as HttpException).getStatus()).toBe(429);
	});
});
