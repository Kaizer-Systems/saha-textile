import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { AuthService } from '@data-access/services/auth.service';

import { ProductReview } from './product-review';

const ids: Array<() => unknown> = [];
vi.mock('@data-access/queries/review.queries', () => ({
	injectReviewQuery: () => ({ data: signal(undefined) }),
	injectMyReviewQuery: (id: () => unknown) => {
		ids.push(id);
		return { data: signal(undefined), refetch: vi.fn() };
	},
}));

describe('ProductReview before its product arrives', () => {
	it('asks about no review and does nothing on the button', async () => {
		const navigate = vi.fn();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: AuthStore, useValue: { isAuthenticated: signal(false), isResolving: signal(false) } },
				{ provide: AuthService, useValue: {} },
				{ provide: Router, useValue: { url: '/', navigate } },
			],
		});
		TestBed.overrideComponent(ProductReview, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(ProductReview);
		fixture.componentRef.setInput('product', null);
		expect(ids.at(-1)?.()).toBeUndefined();
		await fixture.componentInstance.onReviewButton();
		expect(navigate).not.toHaveBeenCalled();
	});

	it('opens no review pop-up when the review state has not caught up with the button', async () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: AuthStore, useValue: { isAuthenticated: signal(true), isResolving: signal(false) } },
				{ provide: AuthService, useValue: {} },
				{ provide: Router, useValue: { url: '/', navigate: vi.fn() } },
			],
		});
		TestBed.overrideComponent(ProductReview, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(ProductReview);
		fixture.componentRef.setInput('product', { id: 'p1', slug: 'red-saree' });
		const review = fixture.componentInstance;
		const modal = { openModal: vi.fn(), openEdit: vi.fn() };
		Object.defineProperty(review, 'reviewModal', { value: () => modal });
		for (const action of ['write', 'edit']) {
			Object.defineProperty(review, 'action', { configurable: true, value: () => action });
			await review.onReviewButton();
		}
		expect(modal.openModal).not.toHaveBeenCalled();
		expect(modal.openEdit).not.toHaveBeenCalled();
	});
});
