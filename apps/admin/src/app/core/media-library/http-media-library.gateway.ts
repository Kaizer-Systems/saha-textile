import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';

import {
	type EmailPictureList,
	type EmailPictureQuery,
	type MediaCleanUpQuery,
	type MediaCleanUpResponse,
	type MediaNightlyCheck,
	type MediaActivityPage,
	type MediaBrowseQuery,
	type MediaBrowseResponse,
	type MediaDuplicateAnswer,
	type MediaDuplicateQuery,
	type MediaFavouriteWrite,
	type MediaFileAddress,
	type MediaCutRequest,
	type MediaCutResult,
	type MediaCutSource,
	type MediaFileDetails,
	type MediaPhotoText,
	type MediaAddVersionsRequest,
	type MediaAddVersionsResult,
	type MediaBulkAddVersionsRequest,
	type MediaVersionsStatus,
	type MediaReplaceRequest,
	type MediaReplaceStatus,
	type MediaReplaceUpload,
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
	type MediaZip,
	type MediaZipList,
	type MediaZipPlan,
	type MediaZipRequest,
	type MediaUploadedParts,
	type MediaPartsRequest,
	type MediaPartUrls,
	type MediaMultipartStart,
	type MediaTrashCheck,
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

	override itemActivity(entityId: string): Observable<MediaActivityPage> {
		return this.http.get<MediaActivityPage>(this.url('/activity'), { params: { page: '1', entityId } });
	}

	override details(fileId: string): Observable<MediaFileDetails> {
		return this.http.get<MediaFileDetails>(this.url(`/files/${id(fileId)}/details`));
	}

	override cutSource(fileId: string): Observable<MediaCutSource> {
		// The pop-up says in words why a picture can't be cut, so the global error toast stays quiet.
		return this.http.get<MediaCutSource>(this.url(`/files/${id(fileId)}/cut-source`), quiet());
	}

	override cut(fileId: string, body: MediaCutRequest): Observable<MediaCutResult> {
		return this.http.post<MediaCutResult>(this.url(`/files/${id(fileId)}/cuts`), body, quiet());
	}

	override addVersions(fileId: string, body: MediaAddVersionsRequest): Observable<MediaAddVersionsResult> {
		return this.http.post<MediaAddVersionsResult>(this.url(`/files/${id(fileId)}/versions`), body, quiet());
	}

	override addVersionsToMany(body: MediaBulkAddVersionsRequest): Observable<MediaAddVersionsResult> {
		return this.http.post<MediaAddVersionsResult>(this.url('/versions'), body, quiet());
	}

	override versionsStatus(fileIds: readonly string[]): Observable<MediaVersionsStatus> {
		return this.http.post<MediaVersionsStatus>(this.url('/versions/status'), { fileIds }, quiet());
	}

	override removeVersion(fileId: string, versionId: string): Observable<void> {
		return this.http.delete<void>(this.url(`/files/${id(fileId)}/versions/${id(versionId)}`), quiet());
	}

	/** The photo's text is saved where every image field's old popup saves it (`PATCH /admin/media/:id`). */
	override saveWebName(fileId: string, slug: string): Observable<void> {
		return this.http
			.patch(`${runtimeConfig.apiUrl}/admin/media/${id(fileId)}`, { slug }, quiet())
			.pipe(map(() => undefined));
	}

	override saveText(fileId: string, text: MediaPhotoText): Observable<void> {
		return this.http
			.patch(`${runtimeConfig.apiUrl}/admin/media/${id(fileId)}`, text, quiet())
			.pipe(map(() => undefined));
	}

	override startReplace(fileId: string, body: MediaReplaceRequest): Observable<MediaReplaceUpload> {
		return this.http.post<MediaReplaceUpload>(this.url(`/files/${id(fileId)}/replace`), body, quiet());
	}

	override finishReplace(fileId: string): Observable<MediaReplaceStatus> {
		return this.http.post<MediaReplaceStatus>(this.url(`/files/${id(fileId)}/replace/finish`), {}, quiet());
	}

	override replaceStatus(fileId: string): Observable<MediaReplaceStatus> {
		return this.http.get<MediaReplaceStatus>(this.url(`/files/${id(fileId)}/replace`), quiet());
	}

	override cancelReplace(fileId: string): Observable<void> {
		return this.http.delete<void>(this.url(`/files/${id(fileId)}/replace`), quiet());
	}

	override setFocal(fileId: string, focal: { x: number; y: number } | null): Observable<MediaReplaceStatus> {
		return this.http.put<MediaReplaceStatus>(this.url(`/files/${id(fileId)}/focal`), { focal }, quiet());
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

	override checkTrash(body: MediaSelection): Observable<MediaTrashCheck> {
		return this.http.post<MediaTrashCheck>(this.url('/trash/check'), body, quiet());
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

	override finalizeFile(fileId: string, uploadId?: string): Observable<{ assetId: string; state: 'ready' }> {
		return this.http.post<{ assetId: string; state: 'ready' }>(
			this.url(`/files/${id(fileId)}/finalize`),
			uploadId ? { uploadId } : {},
			quiet(),
		);
	}

	/** The upload status route of the image pipeline; quiet, the tray says what happened. */
	override photoStatus(fileId: string): Observable<{ state: string; error: string | null }> {
		return this.http.get<{ state: string; error: string | null }>(
			`${runtimeConfig.apiUrl}/admin/media/${id(fileId)}/status`,
			quiet(),
		);
	}

	override cancelUpload(fileId: string, uploadId?: string): Observable<void> {
		return this.http.post<void>(this.url(`/files/${id(fileId)}/cancel`), uploadId ? { uploadId } : {}, quiet());
	}

	override startMultipart(fileId: string): Observable<MediaMultipartStart> {
		return this.http.post<MediaMultipartStart>(this.url(`/files/${id(fileId)}/multipart`), {}, quiet());
	}

	override partUrls(fileId: string, body: MediaPartsRequest): Observable<MediaPartUrls> {
		return this.http.post<MediaPartUrls>(this.url(`/files/${id(fileId)}/parts`), body, quiet());
	}

	override uploadedParts(fileId: string, uploadId: string): Observable<MediaUploadedParts> {
		return this.http.get<MediaUploadedParts>(this.url(`/files/${id(fileId)}/parts`), {
			params: { uploadId },
			...quiet(),
		});
	}

	override setVisibility(fileId: string, visibility: 'public' | 'private'): Observable<MediaOperationResult> {
		return this.http.put<MediaOperationResult>(
			this.url(`/files/${id(fileId)}/visibility`),
			{ visibility },
			quiet(),
		);
	}

	override fileAddress(fileId: string, as: 'view' | 'save'): Observable<MediaFileAddress> {
		return this.http.get<MediaFileAddress>(this.url(`/files/${id(fileId)}/address`), {
			params: { as },
			...quiet(),
		});
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

	override nightlyCheck(): Observable<MediaNightlyCheck | null> {
		return this.http.get<MediaNightlyCheck | null>(this.url('/nightly-check'));
	}

	override zipPlan(body: MediaSelection): Observable<MediaZipPlan> {
		return this.http.post<MediaZipPlan>(this.url('/zips/plan'), body);
	}

	override createZip(body: MediaZipRequest): Observable<MediaZip> {
		return this.http.post<MediaZip>(this.url('/zips'), body);
	}

	override zips(): Observable<MediaZipList> {
		return this.http.get<MediaZipList>(this.url('/zips'));
	}

	override zip(id: string): Observable<MediaZip> {
		return this.http.get<MediaZip>(this.url(`/zips/${encodeURIComponent(id)}`));
	}

	override cancelZip(id: string): Observable<MediaZip> {
		return this.http.post<MediaZip>(this.url(`/zips/${encodeURIComponent(id)}/cancel`), {});
	}

	override zipLink(id: string): Observable<MediaFileAddress> {
		return this.http.get<MediaFileAddress>(this.url(`/zips/${encodeURIComponent(id)}/link`));
	}

	override cleanUp(query: MediaCleanUpQuery): Observable<MediaCleanUpResponse> {
		return this.http.get<MediaCleanUpResponse>(this.url('/clean-up'), {
			params: { list: query.list, page: String(query.page) },
		});
	}

	override emailPictures(query: EmailPictureQuery): Observable<EmailPictureList> {
		const params: Record<string, string> = { sent: query.sent };
		if (query.after) params['after'] = query.after;
		return this.http.get<EmailPictureList>(this.url('/email-pictures'), { params });
	}

	override deleteEmailPictures(keys: readonly string[]): Observable<{ deleted: number; bytes: number }> {
		return this.http.post<{ deleted: number; bytes: number }>(
			this.url('/email-pictures/delete'),
			{ keys },
			quiet(),
		);
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
