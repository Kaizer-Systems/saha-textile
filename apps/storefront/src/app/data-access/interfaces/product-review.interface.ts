/**
 * Product reviews as OUR API returns them, mirroring `packages/contracts` `ProductReviewsResponse`,
 * `MyProductReview` and `ReviewUpdateRequest`. Declared here, not imported: the Angular apps hold
 * their own view types and `check:route-contracts` keeps them honest against the real API.
 */
export interface IReviewPhoto {
	assetId: string;
	thumbUrl: string | null;
	fullUrl: string | null;
	alt: string;
}

export interface IPublicReview {
	id: string;
	rating: number;
	title: string | null;
	body: string;
	/** "Riya S."; empty when the reviewer has no name, and the page says "A customer". */
	authorName: string;
	createdAt: string | null;
	photos: IReviewPhoto[];
}

export interface IReviewSummary {
	average: number;
	count: number;
	buckets: Record<1 | 2 | 3 | 4 | 5, number>;
}

export interface IProductReviews {
	summary: IReviewSummary;
	items: IPublicReview[];
	total: number;
	page: number;
	pageSize: number;
}

export interface IOwnReview {
	id: string;
	rating: number;
	title: string | null;
	body: string;
	status: 'pending' | 'approved' | 'rejected';
	createdAt: string | null;
	photos: IReviewPhoto[];
}

/** What the signed-in customer can do on one product page. */
export type IMyProductReview =
	{ state: 'can_review'; orderId: string } | { state: 'needs_delivery' } | { state: 'reviewed'; review: IOwnReview };

export interface IReviewEdit {
	rating: number;
	title: string | null;
	body: string;
	imageAssetIds: string[];
}
