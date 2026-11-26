import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { AuthService } from '@data-access/services/auth.service';

import { ProductReview } from './product-review';

const reviews = signal<unknown>(undefined);
const mine = signal<unknown>(undefined);
const refetch = vi.fn();
const myReviewArgs: Array<[() => unknown, () => unknown]> = [];
vi.mock('@data-access/queries/review.queries', () => ({
	injectReviewQuery: (slug: () => unknown) => {
		slug();
		return { data: reviews };
	},
	injectMyReviewQuery: (id: () => unknown, signedIn: () => unknown) => {
		myReviewArgs.push([id, signedIn]);
		return { data: mine, refetch };
	},
}));

const authenticated = signal(false);
const resolving = signal(false);
const navigate = vi.fn(async () => true);
const authService: { redirectUrl?: string } = {};

const render = () => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AuthStore, useValue: { isAuthenticated: authenticated, isResolving: resolving } },
			{ provide: AuthService, useValue: authService },
			{ provide: Router, useValue: { url: '/product/red-saree', navigate } },
		],
	});
	TestBed.overrideComponent(ProductReview, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductReview);
	fixture.componentRef.setInput('product', { id: 'p1', slug: 'red-saree' });
	const modal = { openModal: vi.fn(async () => {}), openEdit: vi.fn(async () => {}) };
	const component = fixture.componentInstance;
	Object.defineProperty(component, 'reviewModal', { value: () => modal });
	return { component, modal };
};

beforeEach(() => {
	reviews.set(undefined);
	mine.set(undefined);
	authenticated.set(false);
	resolving.set(false);
	navigate.mockClear();
	refetch.mockClear();
	myReviewArgs.length = 0;
});

describe('ProductReview', () => {
	it('shows an empty summary until the reviews arrive, then the bars', () => {
		const { component } = render();
		expect(component.summary().count).toBe(0);
		expect(component.bars().every((bar) => bar.percent === 0)).toBe(true);
		reviews.set({
			summary: { average: 4.5, count: 4, buckets: { 1: 0, 2: 0, 3: 0, 4: 2, 5: 2 } },
			items: [],
			total: 0,
			page: 1,
			pageSize: 10,
		});
		expect(component.bars()).toEqual([
			{ stars: 5, total: 2, percent: 50 },
			{ stars: 4, total: 2, percent: 50 },
			{ stars: 3, total: 0, percent: 0 },
			{ stars: 2, total: 0, percent: 0 },
			{ stars: 1, total: 0, percent: 0 },
		]);
	});

	it('asks for the customer’s own state only once signed in, keyed on the product id', () => {
		render();
		const [id, signedIn] = myReviewArgs[0] ?? [];
		expect(id?.()).toBe('p1');
		expect(signedIn?.()).toBe(false);
		authenticated.set(true);
		expect(signedIn?.()).toBe(true);
	});

	it('works out what the button does', () => {
		const { component } = render();
		resolving.set(true);
		expect(component.action()).toBe('checking');
		resolving.set(false);
		expect(component.action()).toBe('sign_in');
		authenticated.set(true);
		expect(component.action()).toBe('checking');
		mine.set({ state: 'needs_delivery' });
		expect(component.action()).toBe('wait_for_delivery');
		mine.set({ state: 'can_review', orderId: 'o1' });
		expect(component.action()).toBe('write');
		mine.set({ state: 'reviewed', review: { id: 'r1', status: 'approved' } });
		expect(component.action()).toBe('edit');
		expect(component.ownPending()).toBeNull();
		mine.set({ state: 'reviewed', review: { id: 'r1', status: 'pending' } });
		expect(component.ownPending()).toMatchObject({ id: 'r1' });
	});

	it('sends a guest to sign in and back', async () => {
		const { component } = render();
		await component.onReviewButton();
		expect(authService.redirectUrl).toBe('/product/red-saree');
		expect(navigate).toHaveBeenCalledWith(['/auth/login']);
	});

	it('opens the form to write, or to edit', async () => {
		authenticated.set(true);
		const { component, modal } = render();
		mine.set({ state: 'can_review', orderId: 'o1' });
		await component.onReviewButton();
		expect(modal.openModal).toHaveBeenCalledWith({ id: 'p1', slug: 'red-saree' }, 'create', 'o1');
		const review = { id: 'r1', status: 'approved' };
		mine.set({ state: 'reviewed', review });
		await component.onReviewButton();
		expect(modal.openEdit).toHaveBeenCalledWith({ id: 'p1', slug: 'red-saree' }, review);
		mine.set({ state: 'needs_delivery' });
		await component.onReviewButton();
		expect(modal.openModal).toHaveBeenCalledTimes(1);
		component.onSaved();
		expect(refetch).toHaveBeenCalledOnce();
	});
});
