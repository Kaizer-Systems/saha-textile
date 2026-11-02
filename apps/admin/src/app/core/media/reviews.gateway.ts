import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

export interface ReviewPhoto {
	assetId: string;
	thumbUrl: string | null;
	fullUrl: string | null;
}

/** `AdminReviewRow` from `@saha-textile/contracts`. */
export interface AdminReviewRow {
	review: {
		id: string;
		productId: string;
		userId: string;
		rating: number;
		title: string | null;
		body: string;
		imageAssetIds: string[];
		status: 'pending' | 'approved' | 'rejected';
		createdAt?: string;
	};
	productName: string | null;
	customerName: string | null;
	photos: ReviewPhoto[];
}

export interface AdminReviewListResponse {
	items: AdminReviewRow[];
	total: number;
	page: number;
	pageSize: number;
}

/**
 * Review moderation (owner log § Media → Review photos). Photo URLs are short-lived signed
 * links while a review is pending; approving publishes them, rejecting deletes them.
 */
@Injectable({ providedIn: 'root' })
export class ReviewsGateway {
	private readonly http = inject(HttpClient);

	list(params: { page?: number; pageSize?: number; status?: string }): Observable<AdminReviewListResponse> {
		const query: Record<string, string> = {
			page: String(params.page ?? 1),
			pageSize: String(params.pageSize ?? 20),
		};
		if (params.status) query['status'] = params.status;
		return this.http.get<AdminReviewListResponse>(`${runtimeConfig.apiUrl}/admin/reviews`, { params: query });
	}

	moderate(reviewId: string, decision: 'approve' | 'reject'): Observable<unknown> {
		return this.http.post(`${runtimeConfig.apiUrl}/admin/reviews/${encodeURIComponent(reviewId)}/moderation`, {
			decision,
			note: null,
		});
	}
}
