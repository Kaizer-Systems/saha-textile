import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';

import { environment } from '../../../../public/environments/environment';

import type {
	AdminSearchTermDetail,
	AdminSearchTermListResponse,
	GoLiveGap,
	SearchTermStatus,
	SearchTermWrite,
	StorefrontSearchSettings,
	StorefrontShareSettings,
} from '@saha-textile/contracts';

/** A search word as the table draws it: the English name, its spellings, what it finds and a live switch. */
export interface ISearchTermRow {
	id: string;
	name: string;
	spellings: string;
	finds: string;
	status: '1' | '0';
	updated_at: string | undefined;
}

export interface SearchTermStatusResult {
	updated: string[];
	refused: Array<{ id: string; gaps: GoLiveGap[] }>;
}

/** Products › Search words, and Store front › Storefront settings. */
@Injectable({
	providedIn: 'root',
})
export class SearchTermService {
	private http = inject(HttpClient);
	private base = (path = '') => `${environment.apiUrl}/admin/search-terms${path}`;

	list(payload?: Params): Observable<AdminSearchTermListResponse> {
		const params: Record<string, string> = {
			page: String(Number(payload?.['page']) || 1),
			pageSize: String(Math.min(Number(payload?.['paginate']) || 20, 100)),
		};
		const search = payload?.['search'];
		if (typeof search === 'string' && search.trim()) params['search'] = search.trim();
		const missing = payload?.['missing'];
		if (typeof missing === 'string' && missing) params['missing'] = missing;
		return this.http.get<AdminSearchTermListResponse>(this.base(), { params });
	}

	get(id: string): Observable<AdminSearchTermDetail> {
		return this.http.get<AdminSearchTermDetail>(this.base(`/${encodeURIComponent(id)}`));
	}

	save(id: string | null, body: SearchTermWrite): Observable<{ id: string }> {
		return this.http.post<{ id: string }>(id ? this.base(`/${encodeURIComponent(id)}`) : this.base(), body);
	}

	setStatus(ids: readonly string[], status: SearchTermStatus): Observable<SearchTermStatusResult> {
		return this.http.post<SearchTermStatusResult>(this.base('/status'), { ids, status });
	}

	remove(id: string): Observable<void> {
		return this.http.delete<void>(this.base(`/${encodeURIComponent(id)}`));
	}

	getSearchSettings(): Observable<StorefrontSearchSettings> {
		return this.http.get<StorefrontSearchSettings>(`${environment.apiUrl}/admin/storefront-settings/search`);
	}

	saveSearchSettings(body: StorefrontSearchSettings): Observable<StorefrontSearchSettings> {
		return this.http.put<StorefrontSearchSettings>(`${environment.apiUrl}/admin/storefront-settings/search`, body);
	}

	/** Storefront settings › Sharing (share brief D4). */
	getShareSettings(): Observable<StorefrontShareSettings> {
		return this.http.get<StorefrontShareSettings>(`${environment.apiUrl}/admin/storefront-settings/share`);
	}

	saveShareSettings(body: StorefrontShareSettings): Observable<StorefrontShareSettings> {
		return this.http.put<StorefrontShareSettings>(`${environment.apiUrl}/admin/storefront-settings/share`, body);
	}
}
