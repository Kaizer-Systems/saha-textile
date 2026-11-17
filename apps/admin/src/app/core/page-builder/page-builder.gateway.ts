import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	AdminBuilderPage,
	AdminBuilderPageRow,
	AdminLayoutRow,
	AdminLayoutView,
	CreateLayoutRequest,
	PageSection,
	RenameLayoutRequest,
	SaveLayoutDraft,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export type {
	AdminBuilderPage,
	AdminBuilderPageRow,
	AdminLayoutRow,
	AdminLayoutView,
	CreateLayoutRequest,
	PageSection,
	RenameLayoutRequest,
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

	createLayout(type: string, body: CreateLayoutRequest): Observable<AdminLayoutView> {
		return this.http.post<AdminLayoutView>(this.url(`/pages/${encodeURIComponent(type)}/layouts`), body);
	}

	layout(id: string): Observable<AdminLayoutView> {
		return this.http.get<AdminLayoutView>(this.url(`/layouts/${encodeURIComponent(id)}`));
	}

	saveDraft(id: string, body: SaveLayoutDraft): Observable<AdminLayoutView> {
		return this.http.put<AdminLayoutView>(this.url(`/layouts/${encodeURIComponent(id)}/draft`), body);
	}

	rename(id: string, body: RenameLayoutRequest): Observable<AdminLayoutView> {
		return this.http.patch<AdminLayoutView>(this.url(`/layouts/${encodeURIComponent(id)}`), body);
	}
}
