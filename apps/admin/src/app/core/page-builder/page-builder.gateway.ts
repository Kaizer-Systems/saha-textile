import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	BringBackRequest,
	CancelSwitchRequest,
	GoLiveRequest,
	GoLiveResponse,
	GoLiveView,
	LayoutHistoryResponse,
	PageBuilderAlerts,
	RevisionRow,
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
	BringBackRequest,
	CancelSwitchRequest,
	GoLiveRequest,
	GoLiveResponse,
	GoLiveView,
	LayoutHistoryResponse,
	PageBuilderAlerts,
	RevisionRow,
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

	/** Step 6: a one-time code for the shop's /__preview address (a minute, used once); a saved revision for Look. */
	previewCode(id: string, revisionId: string | null = null): Observable<PreviewCodeResponse> {
		return this.http.post<PreviewCodeResponse>(this.url(`/layouts/${encodeURIComponent(id)}/preview-code`), {
			revisionId,
		});
	}

	/** E1, P6: what Go Live would change, its checks and speed budget, and whether this admin may go live. */
	goLiveView(id: string): Observable<GoLiveView> {
		return this.http.get<GoLiveView>(this.url(`/layouts/${encodeURIComponent(id)}/go-live`));
	}

	/** E2, E5: refused with 400 `go_live_refused` (and the problems) or 409 `layout_moved_on`. */
	goLive(id: string, body: GoLiveRequest): Observable<GoLiveResponse> {
		return this.http.post<GoLiveResponse>(this.url(`/layouts/${encodeURIComponent(id)}/go-live`), body);
	}

	history(id: string): Observable<LayoutHistoryResponse> {
		return this.http.get<LayoutHistoryResponse>(this.url(`/layouts/${encodeURIComponent(id)}/history`));
	}

	bringBack(id: string, body: BringBackRequest): Observable<AdminLayoutView> {
		return this.http.post<AdminLayoutView>(this.url(`/layouts/${encodeURIComponent(id)}/bring-back`), body);
	}

	/** SG-18: ask the owner and super admins to review this draft. */
	askReview(id: string, note: string): Observable<void> {
		return this.http.post<void>(this.url(`/layouts/${encodeURIComponent(id)}/review-request`), { note });
	}

	closeReview(id: string): Observable<void> {
		return this.http.delete<void>(this.url(`/layouts/${encodeURIComponent(id)}/review-request`));
	}

	cancelSwitch(type: string, body: CancelSwitchRequest): Observable<AdminBuilderPage> {
		return this.http.post<AdminBuilderPage>(this.url(`/pages/${encodeURIComponent(type)}/cancel-switch`), body);
	}

	cancelWaiting(type: string, layoutId: string): Observable<AdminBuilderPage> {
		return this.http.delete<AdminBuilderPage>(
			this.url(`/pages/${encodeURIComponent(type)}/waiting/${encodeURIComponent(layoutId)}`),
		);
	}

	/** SG-15: bring back the layout that showed before the one showing now. */
	putBack(type: string): Observable<AdminBuilderPage> {
		return this.http.post<AdminBuilderPage>(this.url(`/pages/${encodeURIComponent(type)}/put-back`), {});
	}

	/** SG-15: super admins only; others are refused (403). */
	safeMode(type: string, on: boolean): Observable<AdminBuilderPage> {
		return this.http.put<AdminBuilderPage>(this.url(`/pages/${encodeURIComponent(type)}/safe-mode`), { on });
	}

	/** The bell's Page Builder lines (SG-12, SG-18). */
	alerts(): Observable<PageBuilderAlerts> {
		return this.http.get<PageBuilderAlerts>(this.url('/alerts'));
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
