import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbRating } from '@ng-bootstrap/ng-bootstrap';

import { AuthStore } from '@core/state/auth.store';
import { IProductReviews } from '@data-access/interfaces/product-review.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { injectMyReviewQuery, injectReviewQuery } from '@data-access/queries/review.queries';
import { AuthService } from '@data-access/services/auth.service';
import { ShopDatePipe } from '@shared/pipes/shop-date.pipe';
import { Button } from '@shared/ui/button/button';
import { ReviewModal } from '@shared/ui/modal/review-modal/review-modal';
import { NoData } from '@shared/ui/no-data/no-data';

/** What the review button does for the person looking. */
export type ReviewAction = 'sign_in' | 'checking' | 'wait_for_delivery' | 'write' | 'edit';

const EMPTY: IProductReviews = {
	summary: { average: 0, count: 0, buckets: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
	items: [],
	total: 0,
	page: 1,
	pageSize: 10,
};

/**
 * The Reviews tab. Approved reviews and the summary come from the public read, so they are in
 * the server HTML; the button below them depends on the shopper and is settled in the browser:
 * a guest is sent to sign in, a customer without a delivered order is told to wait, a buyer
 * writes a review, and someone who already reviewed edits theirs.
 */
@Component({
	selector: 'app-product-review',
	templateUrl: './product-review.html',
	styleUrls: ['./product-review.scss'],
	imports: [Button, NgbRating, NoData, ReviewModal, ShopDatePipe, DecimalPipe, TranslocoModule],
})
export class ProductReview {
	private readonly auth = inject(AuthStore);
	private readonly authService = inject(AuthService);
	private readonly router = inject(Router);

	readonly product = input<IProduct | null>();

	private readonly reviewsQuery = injectReviewQuery(() => this.product()?.slug);
	private readonly mineQuery = injectMyReviewQuery(
		() => (this.product()?.id === undefined ? undefined : String(this.product()?.id)),
		() => this.auth.isAuthenticated(),
	);

	readonly reviewModal = viewChild<ReviewModal>('reviewModal');

	readonly page = computed(() => this.reviewsQuery.data() ?? EMPTY);
	readonly summary = computed(() => this.page().summary);
	/** Five stars first, each with its share of the total for the bar. */
	readonly bars = computed(() => {
		const { buckets, count } = this.summary();
		return ([5, 4, 3, 2, 1] as const).map((stars) => ({
			stars,
			total: buckets[stars],
			percent: count ? Math.round((buckets[stars] / count) * 100) : 0,
		}));
	});
	readonly mine = computed(() => this.mineQuery.data());
	/** The customer's own review, shown to them with its status until it is approved. */
	readonly ownPending = computed(() => {
		const mine = this.mine();
		return mine?.state === 'reviewed' && mine.review.status !== 'approved' ? mine.review : null;
	});

	readonly action = computed<ReviewAction>(() => {
		if (this.auth.isResolving()) return 'checking';
		if (!this.auth.isAuthenticated()) return 'sign_in';
		const mine = this.mine();
		if (!mine) return 'checking';
		if (mine.state === 'reviewed') return 'edit';
		return mine.state === 'can_review' ? 'write' : 'wait_for_delivery';
	});

	async onReviewButton(): Promise<void> {
		const product = this.product();
		const mine = this.mine();
		if (!product) return;
		switch (this.action()) {
			case 'sign_in':
				this.authService.redirectUrl = this.router.url;
				await this.router.navigate(['/auth/login']);
				return;
			case 'write':
				if (mine?.state === 'can_review') await this.reviewModal()?.openModal(product, 'create', mine.orderId);
				return;
			case 'edit':
				if (mine?.state === 'reviewed') await this.reviewModal()?.openEdit(product, mine.review);
				return;
			default:
				return;
		}
	}

	/** A saved review changes what the customer sees; the public list changes only on approval. */
	onSaved(): void {
		void this.mineQuery.refetch();
	}
}
