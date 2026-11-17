import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	AdminBuilderPage,
	AdminBuilderPageRow,
	AdminLayoutRow,
	AdminLayoutView,
	AdminSavedBlockRow,
	ComingUpResponse,
	LayoutLockResponse,
	PreviewCodeResponse,
	CreateLayoutRequest,
	PageSection,
	PageSettings,
	RenameLayoutRequest,
	SaveBlockRequest,
	SaveLayoutDraft,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export type {
	AdminBuilderPage,
	AdminBuilderPageRow,
	AdminLayoutRow,
	AdminLayoutView,
	AdminSavedBlockRow,
	ComingUpResponse,
	LayoutLockResponse,
	PreviewCodeResponse,
	CreateLayoutRequest,
	PageSection,
	PageSettings,
	RenameLayoutRequest,
	SaveBlockRequest,
	SaveLayoutDraft,
};

/**
 * Store Front › Page Builder on the API (Page Builder brief PG-1, PG-2, B): the pages, one page's layouts, a layout
 * open in the builder. Read with `theme_option.index`, saved with `theme_option.edit`. A draft saved over a newer
 * revision answers 409 `layout_moved_on` with who saved it and when.
 */
@Injectable({ providedIn: 'root' })
export class PageBuilderGateway {
	private readonly http = inject(HttpClient);

	private url(path: string): string {
		return `${runtimeConfig.apiUrl}/admin/page-builder${path}`;
	}

	pages(): Observable<AdminBuilderPageRow[]> {
		return this.http.get<AdminBuilderPageRow[]>(this.url('/pages'));
	}

	page(type: string): Observable<AdminBuilderPage> {
		return this.http.get<AdminBuilderPage>(this.url(`/pages/${encodeURIComponent(type)}`));
	}

	/** P3: refused (400, issues `page_settings_incomplete` [field, locale]) until every shop language is filled. */
	saveSettings(type: string, body: PageSettings): Observable<AdminBuilderPage> {
		return this.http.put<AdminBuilderPage>(this.url(`/pages/${encodeURIComponent(type)}/settings`), body);
	}

	/** SG-17: every switch still ahead, on every page. */
	comingUp(): Observable<ComingUpResponse> {
		return this.http.get<ComingUpResponse>(this.url('/coming-up'));
	}

	createLayout(type: string, body: CreateLayoutRequest): Observable<AdminLayoutView> {
		return this.http.post<AdminLayoutView>(this.url(`/pages/${encodeURIComponent(type)}/layouts`), body);
	}

	layout(id: string): Observable<AdminLayoutView> {
		return this.http.get<AdminLayoutView>(this.url(`/layouts/${encodeURIComponent(id)}`));
	}

	saveDraft(id: string, body: SaveLayoutDraft): Observable<AdminLayoutView> {
		return this.http.put<AdminLayoutView>(this.url(`/layouts/${encodeURIComponent(id)}/draft`), body);
	}

	/** E4: take or keep the editing lock; the builder calls it every 30 s while open. */
	lock(id: string): Observable<LayoutLockResponse> {
		return this.http.post<LayoutLockResponse>(this.url(`/layouts/${encodeURIComponent(id)}/lock`), {});
	}

	/** Step 6: a one-time code for the shop's /__preview address (a minute, used once). */
	previewCode(id: string): Observable<PreviewCodeResponse> {
		return this.http.post<PreviewCodeResponse>(this.url(`/layouts/${encodeURIComponent(id)}/preview-code`), {});
	}

	unlock(id: string): Observable<void> {
		return this.http.delete<void>(this.url(`/layouts/${encodeURIComponent(id)}/lock`));
	}

	blocks(): Observable<AdminSavedBlockRow[]> {
		return this.http.get<AdminSavedBlockRow[]>(this.url('/blocks'));
	}

	createBlock(body: SaveBlockRequest): Observable<AdminSavedBlockRow> {
		return this.http.post<AdminSavedBlockRow>(this.url('/blocks'), body);
	}

	updateBlock(id: string, body: SaveBlockRequest): Observable<AdminSavedBlockRow> {
		return this.http.put<AdminSavedBlockRow>(this.url(`/blocks/${encodeURIComponent(id)}`), body);
	}

	removeBlock(id: string): Observable<void> {
		return this.http.delete<void>(this.url(`/blocks/${encodeURIComponent(id)}`));
	}

	rename(id: string, body: RenameLayoutRequest): Observable<AdminLayoutView> {
		return this.http.patch<AdminLayoutView>(this.url(`/layouts/${encodeURIComponent(id)}`), body);
	}
}
