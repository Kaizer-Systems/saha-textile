import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';

import {
	type MediaActivityPage,
	type MediaBrowseQuery,
	type MediaBrowseResponse,
	type MediaDuplicateAnswer,
	type MediaDuplicateQuery,
	type MediaFavouriteWrite,
	type MediaFilePresignRequest,
	type MediaFilePresignResponse,
	type MediaFolderCreate,
	type MediaFolderRow,
	type MediaFolderTree,
	MediaLibraryGateway,
	type MediaMoveRequest,
	type MediaOperationResult,
	type MediaRestoreRequest,
	type MediaSelection,
	type ShareLinkCreate,
	type ShareLinkUpdate,
	type ShareLinkView,
	type ShareLinksResponse,
	type StorageCheckAnswer,
	type StorageCheckRequest,
	type StorageSettingsWrite,
	type StorageSummary,
} from './media-library.gateway';

/** Changes are quiet: the Media page names each refusal in its own words (popups, toasts). */
const quiet = () => ({ context: new HttpContext().set(QUIET_ERRORS, true) });
const id = (value: string) => encodeURIComponent(value);

@Injectable({ providedIn: 'root' })
export class HttpMediaLibraryGateway extends MediaLibraryGateway {
	private readonly http = inject(HttpClient);
	/** Read per call: the runtime config loads after the app starts. */
	private url(path = ''): string {
		return `${runtimeConfig.apiUrl}/admin/media/library${path}`;
	}

	override browse(query: Partial<MediaBrowseQuery>): Observable<MediaBrowseResponse> {
		let params = new HttpParams();
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
		}
		return this.http.get<MediaBrowseResponse>(this.url(), { params });
	}

	override tree(): Observable<MediaFolderTree> {
		return this.http.get<MediaFolderTree>(this.url('/tree'));
	}

	override activity(page: number): Observable<MediaActivityPage> {
		return this.http.get<MediaActivityPage>(this.url('/activity'), { params: { page: String(page) } });
	}

	override createFolder(body: MediaFolderCreate): Observable<MediaFolderRow> {
		return this.http.post<MediaFolderRow>(this.url('/folders'), body, quiet());
	}

	override renameFolder(folderId: string, name: string): Observable<MediaOperationResult> {
		return this.http.patch<MediaOperationResult>(this.url(`/folders/${id(folderId)}`), { name }, quiet());
	}

	override renameFile(fileId: string, name: string): Observable<MediaOperationResult> {
		return this.http.patch<MediaOperationResult>(this.url(`/files/${id(fileId)}`), { name }, quiet());
	}

	override move(body: MediaMoveRequest): Observable<MediaOperationResult> {
		return this.http.post<MediaOperationResult>(this.url('/move'), body, quiet());
	}

	override trash(body: MediaSelection): Observable<MediaOperationResult> {
		return this.http.post<MediaOperationResult>(this.url('/trash'), body, quiet());
	}

	override restore(body: MediaRestoreRequest): Observable<MediaOperationResult> {
		return this.http.post<MediaOperationResult>(this.url('/restore'), body, quiet());
	}

	override deleteForever(body: MediaSelection): Observable<MediaOperationResult> {
		return this.http.post<MediaOperationResult>(this.url('/delete-forever'), body, quiet());
	}

	override undo(undoId: string): Observable<MediaOperationResult> {
		return this.http.post<MediaOperationResult>(this.url(`/undo/${id(undoId)}`), {}, quiet());
	}

	override star(body: MediaFavouriteWrite): Observable<{ starred: boolean }> {
		return this.http.put<{ starred: boolean }>(this.url('/favourites'), body, quiet());
	}

	override duplicates(body: MediaDuplicateQuery): Observable<MediaDuplicateAnswer> {
		return this.http.post<MediaDuplicateAnswer>(this.url('/duplicates'), body, quiet());
	}

	override presignFile(body: MediaFilePresignRequest): Observable<MediaFilePresignResponse> {
		return this.http.post<MediaFilePresignResponse>(this.url('/files/presign'), body, quiet());
	}

	override finalizeFile(fileId: string): Observable<{ assetId: string; state: 'ready' }> {
		return this.http.post<{ assetId: string; state: 'ready' }>(
			this.url(`/files/${id(fileId)}/finalize`),
			{},
			quiet(),
		);
	}

	override setVisibility(fileId: string, visibility: 'public' | 'private'): Observable<MediaOperationResult> {
		return this.http.put<MediaOperationResult>(
			this.url(`/files/${id(fileId)}/visibility`),
			{ visibility },
			quiet(),
		);
	}

	override links(fileId: string): Observable<ShareLinksResponse> {
		return this.http.get<ShareLinksResponse>(this.url(`/files/${id(fileId)}/links`));
	}

	override createLink(fileId: string, body: ShareLinkCreate): Observable<ShareLinkView> {
		return this.http.post<ShareLinkView>(this.url(`/files/${id(fileId)}/links`), body, quiet());
	}

	override updateLink(linkId: string, body: ShareLinkUpdate): Observable<ShareLinkView> {
		return this.http.patch<ShareLinkView>(this.url(`/links/${id(linkId)}`), body, quiet());
	}

	override storage(): Observable<StorageSummary> {
		return this.http.get<StorageSummary>(this.url('/storage'));
	}

	override checkStorage(body: StorageCheckRequest): Observable<StorageCheckAnswer> {
		return this.http.post<StorageCheckAnswer>(this.url('/storage/check'), body, quiet());
	}

	override releaseHold(holdId: string): Observable<void> {
		return this.http.delete<void>(this.url(`/storage/holds/${id(holdId)}`), quiet());
	}

	override saveStorageSettings(body: StorageSettingsWrite): Observable<{ othersMayUseOnDemand: boolean }> {
		return this.http.put<{ othersMayUseOnDemand: boolean }>(this.url('/storage/settings'), body, quiet());
	}
}
