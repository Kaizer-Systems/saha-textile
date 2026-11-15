import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Subject, lastValueFrom } from 'rxjs';

import { MEDIA_LIBRARY_KEY } from '@data-access/queries/media-library.queries';

import { MediaLibraryGateway } from './media-library.gateway';

export type UploadState = 'waiting' | 'uploading' | 'done' | 'failed';

/** One file in the upload tray (B08, B20). */
export interface UploadJob {
	id: string;
	/** The name it was picked with. */
	name: string;
	/** The name Media gave it: “(1)” when keeping both (B14). */
	savedAs: string | null;
	bytes: number;
	sent: number;
	contentType: string;
	folderId: string | null;
	state: UploadState;
	error: string | null;
	assetId: string | null;
	startedAt: number | null;
}

/** What the page hands over once the popups are answered. */
export interface UploadRequest {
	file: File;
	name: string;
	contentType: string;
	folderId: string | null;
	sha256: string | null;
}

/** Uploads at once: enough to fill a line, few enough that each shows steady progress. */
export const UPLOADS_AT_ONCE = 3;
/** The tray's numbers update at most this often per file, so a fast line does not redraw the page constantly. */
const PROGRESS_EVERY_MS = 200;
/** The lists refresh this long after the last finished file, so a big batch refreshes once, not per file. */
const REFRESH_AFTER_MS = 800;

interface Running {
	file: File;
	sha256: string | null;
	reservationId: string | null;
	request: XMLHttpRequest | null;
}

/**
 * The Media page's uploads (step 1.5e). App-wide, so moving around the admin never stops them
 * (B08): each file is named in its folder by the API, sent straight to Spaces with real progress,
 * then finished. A batch runs under one storage approval, released when its last file settles.
 * Closing or reloading the tab while files are sending gets the browser's own warning (S4, B09).
 */
@Injectable({ providedIn: 'root' })
export class MediaUploads {
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly queries = inject(QueryClient);
	private readonly transloco = inject(TranslocoService);

	readonly jobs = signal<readonly UploadJob[]>([]);
	readonly active = computed(() => this.jobs().filter((job) => job.state === 'waiting' || job.state === 'uploading'));
	readonly doneCount = computed(() => this.jobs().filter((job) => job.state === 'done').length);
	readonly failedCount = computed(() => this.jobs().filter((job) => job.state === 'failed').length);
	/** Files that finished under another name than they were picked with (B14). */
	readonly renamed = new Subject<UploadJob>();

	private readonly running = new Map<string, Running>();
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private counter = 0;

	constructor() {
		const warn = (event: BeforeUnloadEvent) => {
			if (!this.active().length) return;
			event.preventDefault();
			// Older browsers show their own box only when this is set; its words cannot be changed.
			event.returnValue = '';
		};
		if (typeof window !== 'undefined') {
			window.addEventListener('beforeunload', warn);
			inject(DestroyRef).onDestroy(() => window.removeEventListener('beforeunload', warn));
		}
	}

	/** Queues files; `reservationId` is the storage approval the whole batch runs under (B18). */
	add(requests: readonly UploadRequest[], reservationId: string | null): void {
		const added: UploadJob[] = requests.map((request) => {
			this.counter += 1;
			const id = `upl_${Date.now().toString(36)}_${this.counter}`;
			this.running.set(id, { file: request.file, sha256: request.sha256, reservationId, request: null });
			return {
				id,
				name: request.name,
				savedAs: null,
				bytes: request.file.size,
				sent: 0,
				contentType: request.contentType,
				folderId: request.folderId,
				state: 'waiting',
				error: null,
				assetId: null,
				startedAt: null,
			};
		});
		if (!added.length) {
			if (reservationId) void this.release(reservationId);
			return;
		}
		this.jobs.update((jobs) => [...jobs, ...added]);
		this.pump();
	}

	/** Tries a failed file again from the start; the unfinished record goes first. */
	retry(id: string): void {
		const job = this.find(id);
		if (!job || job.state !== 'failed') return;
		if (job.assetId) void this.forget(job.assetId);
		this.patch(id, { state: 'waiting', error: null, sent: 0, assetId: null, startedAt: null });
		this.pump();
	}

	/** Clears finished and failed files from the tray; failed ones leave nothing behind. */
	dismiss(): void {
		for (const job of this.jobs()) {
			if (job.state === 'failed' && job.assetId) void this.forget(job.assetId);
			if (job.state === 'done' || job.state === 'failed') this.running.delete(job.id);
		}
		this.jobs.update((jobs) => jobs.filter((job) => job.state === 'waiting' || job.state === 'uploading'));
	}

	/** Upload progress per stored file, for the list's status cell and the folder cards (B06). */
	readonly byAsset = computed(() => {
		const out = new Map<string, UploadJob>();
		for (const job of this.jobs()) if (job.assetId && job.state !== 'done') out.set(job.assetId, job);
		return out;
	});

	private pump(): void {
		const uploading = this.jobs().filter((job) => job.state === 'uploading').length;
		const next = this.jobs()
			.filter((job) => job.state === 'waiting')
			.slice(0, Math.max(0, UPLOADS_AT_ONCE - uploading));
		for (const job of next) void this.run(job.id);
	}

	private async run(id: string): Promise<void> {
		const job = this.find(id);
		const held = this.running.get(id);
		if (!job || !held) return;
		this.patch(id, { state: 'uploading', startedAt: Date.now(), sent: 0 });
		try {
			const presigned = await lastValueFrom(
				this.gateway.presignFile({
					fileName: job.name,
					contentType: job.contentType,
					byteSize: job.bytes,
					folderId: job.folderId,
					...(held.sha256 ? { sha256: held.sha256 } : {}),
					...(held.reservationId ? { reservationId: held.reservationId } : {}),
				}),
			);
			this.patch(id, { assetId: presigned.assetId, savedAs: presigned.name });
			this.refreshSoon();
			await this.send(id, held, presigned.uploadUrl, presigned.headers);
			await lastValueFrom(this.gateway.finalizeFile(presigned.assetId));
			this.patch(id, { state: 'done', sent: job.bytes });
			const finished = this.find(id);
			if (finished && finished.savedAs && finished.savedAs !== finished.name) this.renamed.next(finished);
		} catch (error) {
			this.patch(id, {
				state: 'failed',
				error:
					error instanceof SendFailed
						? this.transloco.translate('fm_upload_connection_lost')
						: (readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed')),
			});
		} finally {
			held.request = null;
			this.refreshSoon();
			this.settle(held.reservationId);
			this.pump();
		}
	}

	/** The bytes go straight to Spaces with the signed headers; never the admin's cookies. */
	private send(id: string, held: Running, url: string, headers: Record<string, string>): Promise<void> {
		return new Promise((done, failed) => {
			const request = new XMLHttpRequest();
			held.request = request;
			request.open('PUT', url);
			for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
			let shown = 0;
			request.upload.onprogress = (event) => {
				const now = Date.now();
				if (now - shown < PROGRESS_EVERY_MS && event.loaded < event.total) return;
				shown = now;
				this.patch(id, { sent: event.loaded });
			};
			request.onload = () =>
				request.status >= 200 && request.status < 300 ? done() : failed(new SendFailed(request.status));
			request.onerror = () => failed(new SendFailed(0));
			request.onabort = () => failed(new SendFailed(0));
			request.send(held.file);
		});
	}

	/** When every file of a batch has settled, its storage approval is given back. */
	private settle(reservationId: string | null): void {
		if (!reservationId) return;
		const open = this.jobs().some(
			(job) =>
				(job.state === 'waiting' || job.state === 'uploading') &&
				this.running.get(job.id)?.reservationId === reservationId,
		);
		if (!open) void this.release(reservationId);
	}

	private async release(reservationId: string): Promise<void> {
		try {
			await lastValueFrom(this.gateway.releaseHold(reservationId));
		} catch {
			// The hold ends by itself within the hour.
		}
	}

	private async forget(assetId: string): Promise<void> {
		try {
			await lastValueFrom(this.gateway.cancelUpload(assetId));
		} catch {
			// Already gone, or finished meanwhile.
		}
		this.refreshSoon();
	}

	private refreshSoon(): void {
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
		}, REFRESH_AFTER_MS);
	}

	private find(id: string): UploadJob | undefined {
		return this.jobs().find((job) => job.id === id);
	}

	private patch(id: string, changes: Partial<UploadJob>): void {
		this.jobs.update((jobs) => jobs.map((job) => (job.id === id ? { ...job, ...changes } : job)));
	}
}

/** The PUT to Spaces did not complete: the connection dropped, or Spaces said no. */
class SendFailed extends Error {
	constructor(readonly status: number) {
		super(`Upload to storage failed (${status})`);
	}
}
