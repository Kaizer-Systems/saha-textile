import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';

import { ProductDetailsTabs } from './product-details-tabs';

const qna = signal<unknown>(undefined);
const pending = signal(true);
const reviews = signal<unknown>(undefined);
vi.mock('@data-access/queries/questions-answers.queries', () => ({
	injectQuestionAnswersQuery: (id: () => unknown) => {
		id();
		return { data: qna, isPending: pending };
	},
}));
vi.mock('@data-access/queries/review.queries', () => ({
	injectReviewQuery: (id: () => unknown) => {
		id();
		return { data: reviews };
	},
}));

describe('ProductDetailsTabs', () => {
	it('follows the Q&A load and lists both panes', async () => {
		const service = { skeletonLoader: false };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: QuestionsAnswersService, useValue: service }] });
		TestBed.overrideComponent(ProductDetailsTabs, { set: { imports: [], template: '' } });
		const tabs = TestBed.createComponent(ProductDetailsTabs).componentInstance;
		TestBed.tick();
		expect(service.skeletonLoader).toBe(true);
		expect(await firstValueFrom(tabs.question$)).toEqual({ data: [], total: 0 });
		expect(await firstValueFrom(tabs.review$)).toEqual({ data: [], total: 0 });
		pending.set(false);
		qna.set({ data: [1], total: 1 });
		reviews.set({ data: [2], total: 1 });
		TestBed.tick();
		expect(service.skeletonLoader).toBe(false);
		expect(await firstValueFrom(tabs.question$)).toMatchObject({ total: 1 });
		expect(await firstValueFrom(tabs.review$)).toMatchObject({ total: 1 });
	});
});
