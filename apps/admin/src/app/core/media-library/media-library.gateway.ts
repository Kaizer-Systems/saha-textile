import type {
	EmailPictureList,
	EmailPictureQuery,
	EmailPictureRow,
	MediaCleanUpQuery,
	MediaCleanUpResponse,
	MediaCleanUpRow,
	MediaNightlyCheck,
	MediaBrowseQuery,
	MediaCategory,
	MediaFileRow,
	MediaBrowseResponse,
	MediaDuplicateAnswer,
	MediaDuplicateQuery,
	MediaFavouriteWrite,
	MediaFileAddress,
	MediaFileDetails,
	MediaAddVersionsRequest,
	MediaAddVersionsResult,
	MediaBulkAddVersionsRequest,
	MediaVersionsStatus,
	MediaReplaceRequest,
	MediaReplaceStatus,
	MediaReplaceUpload,
	MediaFilePresignRequest,
	MediaFilePresignResponse,
	MediaFolderCreate,
	MediaFolderRow,
	MediaFolderTree,
	MediaMoveRequest,
	MediaOperationResult,
	MediaRestoreRequest,
	MediaSelection,
	MediaUploadedParts,
	MediaPartsRequest,
	MediaPartUrls,
	MediaMultipartStart,
	MediaTrashCheck,
	ShareLinkCreate,
	ShareLinkUpdate,
	ShareLinkView,
	ShareLinksResponse,
	StorageCheckAnswer,
	StorageCheckRequest,
	StorageSettingsWrite,
	StorageSummary,
	MediaZip,
	MediaZipList,
	MediaZipPlan,
	MediaZipRequest,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export type {
	EmailPictureList,
	EmailPictureQuery,
	EmailPictureRow,
	MediaCleanUpQuery,
	MediaCleanUpResponse,
	MediaCleanUpRow,
	MediaNightlyCheck,
	MediaZip,
	MediaZipList,
	MediaZipPlan,
	MediaZipRequest,
	MediaFileDetails,
	MediaAddVersionsRequest,
	MediaBulkAddVersionsRequest,
	MediaAddVersionsResult,
	MediaVersionsStatus,
	MediaReplaceRequest,
	MediaReplaceStatus,
	MediaReplaceUpload,
	MediaBrowseQuery,
	MediaCategory,
	MediaFileRow,
	MediaBrowseResponse,
	MediaDuplicateAnswer,
	MediaDuplicateQuery,
	MediaFavouriteWrite,
	MediaFileAddress,
	MediaFilePresignRequest,
	MediaFilePresignResponse,
	MediaFolderCreate,
	MediaFolderRow,
	MediaFolderTree,
	MediaMoveRequest,
	MediaOperationResult,
	MediaRestoreRequest,
	MediaSelection,
	MediaUploadedParts,
	MediaPartsRequest,
	MediaPartUrls,
	MediaMultipartStart,
	MediaTrashCheck,
	ShareLinkCreate,
	ShareLinkUpdate,
	ShareLinkView,
	ShareLinksResponse,
	StorageCheckAnswer,
	StorageCheckRequest,
	StorageSettingsWrite,
	StorageSummary,
};

/** One Activity line (S9): the audit trail of the Media page, newest first. */
export interface MediaActivityEntry {
	id: string;
	action: string;
	actorUserId: string | null;
	entityId: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
}
export interface MediaActivityPage {
	items: MediaActivityEntry[];
	total: number;
	page: number;
	pageSize: number;
}

/**
 * The Media page as a file manager (media build step 1): browsing, folders, moves, Trash, stars,
 * the duplicate check, plain files, share links and storage, all under `/admin/media/library`.
 */
/** A photo's default alt text and caption, per language (A42; the unused title is dropped, R5-7). */
export interface MediaPhotoText {
	alt: Record<string, string>;
	caption: Record<string, string>;
}

export abstract class MediaLibraryGateway {
	abstract browse(query: Partial<MediaBrowseQuery>): Observable<MediaBrowseResponse>;
	abstract tree(): Observable<MediaFolderTree>;
	abstract activity(page: number): Observable<MediaActivityPage>;
	/** One file's or folder's own trail (A43). */
	abstract itemActivity(entityId: string): Observable<MediaActivityPage>;
	/** What the details popup shows (A31, A31B, A32). */
	abstract details(id: string): Observable<MediaFileDetails>;
	/** Reprocess (step 3): add versions to one photo (C01), or the same ones to many (C07). */
	abstract addVersions(id: string, body: MediaAddVersionsRequest): Observable<MediaAddVersionsResult>;
	abstract addVersionsToMany(body: MediaBulkAddVersionsRequest): Observable<MediaAddVersionsResult>;
	/** How many of these photos still have versions being made (the tray, A48). */
	abstract versionsStatus(fileIds: readonly string[]): Observable<MediaVersionsStatus>;
	/** Removes a version the website does not show (A31). */
	abstract removeVersion(id: string, versionId: string): Observable<void>;
	/** A photo's own text (A42): the default alt text and the caption, per language. */
	abstract saveText(id: string, text: MediaPhotoText): Observable<void>;
	/** Replace a photo (S7, C08): start, finish the upload, follow it, or stop it. */
	abstract startReplace(id: string, body: MediaReplaceRequest): Observable<MediaReplaceUpload>;
	abstract finishReplace(id: string): Observable<MediaReplaceStatus>;
	abstract replaceStatus(id: string): Observable<MediaReplaceStatus>;
	abstract cancelReplace(id: string): Observable<void>;
	/** The point every crop keeps (S10); the photo's Crop versions are then remade around it. */
	abstract setFocal(id: string, focal: { x: number; y: number } | null): Observable<MediaReplaceStatus>;

	abstract createFolder(body: MediaFolderCreate): Observable<MediaFolderRow>;
	abstract renameFolder(id: string, name: string): Observable<MediaOperationResult>;
	abstract renameFile(id: string, name: string): Observable<MediaOperationResult>;
	abstract move(body: MediaMoveRequest): Observable<MediaOperationResult>;
	/** Before Trash (A26): which chosen images the website uses; nothing moves. */
	abstract checkTrash(body: MediaSelection): Observable<MediaTrashCheck>;
	abstract trash(body: MediaSelection): Observable<MediaOperationResult>;
	abstract restore(body: MediaRestoreRequest): Observable<MediaOperationResult>;
	abstract deleteForever(body: MediaSelection): Observable<MediaOperationResult>;
	abstract undo(undoId: string): Observable<MediaOperationResult>;
	abstract star(body: MediaFavouriteWrite): Observable<{ starred: boolean }>;
	abstract duplicates(body: MediaDuplicateQuery): Observable<MediaDuplicateAnswer>;

	abstract presignFile(body: MediaFilePresignRequest): Observable<MediaFilePresignResponse>;
	abstract finalizeFile(id: string, uploadId?: string): Observable<{ assetId: string; state: 'ready' }>;
	/** A photo's processing: `ready` once its versions are made, `failed` with the reason. */
	abstract photoStatus(id: string): Observable<{ state: string; error: string | null }>;
	/** Drop your own unfinished upload (cancelled, or failed for good), with any parts already stored. */
	abstract cancelUpload(id: string, uploadId?: string): Observable<void>;
	/** S11: a big file in parts that resume. */
	abstract startMultipart(id: string): Observable<MediaMultipartStart>;
	abstract partUrls(id: string, body: MediaPartsRequest): Observable<MediaPartUrls>;
	abstract uploadedParts(id: string, uploadId: string): Observable<MediaUploadedParts>;
	abstract setVisibility(id: string, visibility: 'public' | 'private'): Observable<MediaOperationResult>;
	/** Preview (`view`) or Download (`save`): a five-minute address for the original. */
	abstract fileAddress(id: string, as: 'view' | 'save'): Observable<MediaFileAddress>;

	abstract links(id: string): Observable<ShareLinksResponse>;
	abstract createLink(id: string, body: ShareLinkCreate): Observable<ShareLinkView>;
	abstract updateLink(linkId: string, body: ShareLinkUpdate): Observable<ShareLinkView>;

	abstract storage(): Observable<StorageSummary>;
	/** Clean up › Email pictures (A50): email pictures whose photo was deleted or replaced, kept for good. */
	abstract emailPictures(query: EmailPictureQuery): Observable<EmailPictureList>;
	/** Clean up's other lists (A44): not used for 90 days, the largest, the same file twice. */
	abstract cleanUp(query: MediaCleanUpQuery): Observable<MediaCleanUpResponse>;
	/** The nightly Spaces check's last result (R5-5), or null before the first night. */
	abstract nightlyCheck(): Observable<MediaNightlyCheck | null>;
	/** A51: deletes the chosen email pictures for good, after the warning. */
	abstract deleteEmailPictures(keys: readonly string[]): Observable<{ deleted: number; bytes: number }>;
	abstract checkStorage(body: StorageCheckRequest): Observable<StorageCheckAnswer>;
	abstract releaseHold(holdId: string): Observable<void>;
	abstract saveStorageSettings(body: StorageSettingsWrite): Observable<{ othersMayUseOnDemand: boolean }>;

	// Folder downloads as .zip (media step 5, A30, A30B, A48).
	abstract zipPlan(body: MediaSelection): Observable<MediaZipPlan>;
	abstract createZip(body: MediaZipRequest): Observable<MediaZip>;
	abstract zips(): Observable<MediaZipList>;
	abstract zip(id: string): Observable<MediaZip>;
	abstract cancelZip(id: string): Observable<MediaZip>;
	abstract zipLink(id: string): Observable<MediaFileAddress>;
}
