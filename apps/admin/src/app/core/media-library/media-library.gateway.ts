import type {
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
	MediaTrashCheck,
	ShareLinkCreate,
	ShareLinkUpdate,
	ShareLinkView,
	ShareLinksResponse,
	StorageCheckAnswer,
	StorageCheckRequest,
	StorageSettingsWrite,
	StorageSummary,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export type {
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
export abstract class MediaLibraryGateway {
	abstract browse(query: Partial<MediaBrowseQuery>): Observable<MediaBrowseResponse>;
	abstract tree(): Observable<MediaFolderTree>;
	abstract activity(page: number): Observable<MediaActivityPage>;

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
	abstract finalizeFile(id: string): Observable<{ assetId: string; state: 'ready' }>;
	abstract setVisibility(id: string, visibility: 'public' | 'private'): Observable<MediaOperationResult>;
	/** Preview (`view`) or Download (`save`): a five-minute address for the original. */
	abstract fileAddress(id: string, as: 'view' | 'save'): Observable<MediaFileAddress>;

	abstract links(id: string): Observable<ShareLinksResponse>;
	abstract createLink(id: string, body: ShareLinkCreate): Observable<ShareLinkView>;
	abstract updateLink(linkId: string, body: ShareLinkUpdate): Observable<ShareLinkView>;

	abstract storage(): Observable<StorageSummary>;
	abstract checkStorage(body: StorageCheckRequest): Observable<StorageCheckAnswer>;
	abstract releaseHold(holdId: string): Observable<void>;
	abstract saveStorageSettings(body: StorageSettingsWrite): Observable<{ othersMayUseOnDemand: boolean }>;
}
