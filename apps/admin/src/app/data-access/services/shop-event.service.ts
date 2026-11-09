import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';

import { environment } from '../../../../public/environments/environment';

import type {
	AdminShopEventListResponse,
	ShopEvent,
	ShopEventCategoryProducts,
	ShopEventCreate,
	ShopEventPreviewLink,
	ShopEventPublishResult,
	ShopEventReview,
	ShopEventStatus,
	ShopEventType,
	ShopEventWrite,
} from '@saha-textile/contracts';

/** An event as the events table draws it. */
export interface IShopEventRow {
	id: string;
	name: string;
	type_label: string;
	status_pill: string;
	status: ShopEventStatus;
	starts_at: string | null;
	ends_at: string | null;
	event: ShopEvent;
}

/** The existing status-* pill each state wears (order list classes). */
export const EVENT_STATUS_PILL: Readonly<Record<ShopEventStatus, string>> = {
	draft: 'draft',
	scheduled: 'pending',
	live: 'processing',
	ended: 'completed',
	cancelled: 'cancelled',
};

/** Table columns that sort, and the list query's names for them. */
const SORT_FIELDS: Readonly<Record<string, 'name' | 'startsAt' | 'endsAt'>> = {
	name: 'name',
	starts_at: 'startsAt',
	ends_at: 'endsAt',
};

/** The admin events API: launches and sales, their Review, Publish and the clock-side actions. */
@Injectable({ providedIn: 'root' })
export class ShopEventService {
	private http = inject(HttpClient);
	private base = (path = '') => `${environment.apiUrl}/admin/events${path}`;

	list(payload?: Params): Observable<{ data: ShopEvent[]; total: number }> {
		const params: Record<string, string> = {
			page: String(Number(payload?.['page']) || 1),
			pageSize: String(Math.min(Number(payload?.['paginate']) || 20, 100)),
		};
		const search = payload?.['search'];
		if (typeof search === 'string' && search.trim()) params['search'] = search.trim();
		const type = payload?.['type'];
		if (type === 'launch' || type === 'sale') params['type'] = type;
		const field = SORT_FIELDS[String(payload?.['field'] ?? '')];
		if (field) {
			params['sort'] = field;
			params['direction'] = payload?.['sort'] === 'asc' ? 'asc' : 'desc';
		}
		return this.http
			.get<AdminShopEventListResponse>(this.base(), { params })
			.pipe(map((page) => ({ data: page.items, total: page.total })));
	}

	get(id: string): Observable<ShopEvent> {
		return this.http.get<ShopEvent>(this.base(`/${encodeURIComponent(id)}`));
	}

	review(id: string): Observable<ShopEventReview> {
		return this.http.get<ShopEventReview>(this.base(`/${encodeURIComponent(id)}/review`));
	}

	create(type: ShopEventType, body: ShopEventWrite): Observable<ShopEvent> {
		return this.http.post<ShopEvent>(this.base(), { ...body, type } satisfies ShopEventCreate);
	}

	save(id: string, body: ShopEventWrite): Observable<ShopEvent> {
		return this.http.post<ShopEvent>(this.base(`/${encodeURIComponent(id)}`), body);
	}

	publish(id: string): Observable<ShopEventPublishResult> {
		return this.http.post<ShopEventPublishResult>(this.base(`/${encodeURIComponent(id)}/publish`), {});
	}

	unpublish(id: string): Observable<ShopEvent> {
		return this.http.post<ShopEvent>(this.base(`/${encodeURIComponent(id)}/unpublish`), {});
	}

	cancel(id: string): Observable<ShopEvent> {
		return this.http.post<ShopEvent>(this.base(`/${encodeURIComponent(id)}/cancel`), {});
	}

	endNow(id: string): Observable<ShopEvent> {
		return this.http.post<ShopEvent>(this.base(`/${encodeURIComponent(id)}/end-now`), {});
	}

	/** A 30-minute link the shop opens the event popup with, published or not. */
	previewLink(id: string): Observable<ShopEventPreviewLink> {
		return this.http.post<ShopEventPreviewLink>(this.base(`/${encodeURIComponent(id)}/preview`), {});
	}

	sendTest(id: string): Observable<{ sent: boolean }> {
		return this.http.post<{ sent: boolean }>(this.base(`/${encodeURIComponent(id)}/test-message`), {});
	}

	remove(id: string): Observable<void> {
		return this.http.delete<void>(this.base(`/${encodeURIComponent(id)}`));
	}

	categoryProducts(categoryId: string): Observable<ShopEventCategoryProducts> {
		return this.http.get<ShopEventCategoryProducts>(
			this.base(`/category-products/${encodeURIComponent(categoryId)}`),
		);
	}
}
