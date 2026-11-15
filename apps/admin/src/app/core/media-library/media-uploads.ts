import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { MULTIPART_FROM_BYTES, MULTIPART_PART_BYTES } from '@saha-textile/core-domain/media-files';
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
	/** A big upload in parts: its id at Spaces, so it can carry on (S11). */
	uploadId: string | null;
	/** The line dropped; the part is tried again shortly (B15). */
	paused: boolean;
}

/** A big upload cut off by a closed tab (B16): enough to carry on once the same file is chosen. */
export interface CutOffUpload {
	assetId: string;
	uploadId: string;
	name: string;
	bytes: number;
	lastModified: number;
	folderId: string | null;
	/** About how much had arrived. */
	sent: number;
}

/** Where cut-off uploads are remembered in this browser (S11); nothing else is kept there. */
export const RESUME_KEY = 'saha-textile.media.resume';
/** A part that fails is tried again after this long (B15), this many times. */
export const PART_RETRY_MS = 5000;
export const PART_RETRIES = 3;

/** What the page hands over once the popups are answered. */
export interface UploadRequest {
	file: File;
	name: string;
	contentType: string;
	folderId: string | null;
	sha256: string | null;
}

/** A bulk change in the tray (A48): its words, its icon, and real counts from the API's answers. */
export interface MediaOperation {
	id: string;
	label: string;
	icon: string;
	done: number;
	total: number;
	state: 'running' | 'done' | 'failed';
	error: string | null;
}

/** A change that ends sooner than this shows no bar at all (A49): a bar that flashes is flicker. */
export const OPERATION_BAR_AFTER_MS = 300;

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
	uploadId: string | null;
	partBytes: number;
	/** Carry on: ask Spaces which parts it already has. */
	resume: boolean;
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
	readonly operations = signal<readonly MediaOperation[]>([]);
	readonly runningOperations = computed(() => this.operations().filter((op) => op.state === 'running'));
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
			this.running.set(id, {
				file: request.file,
				sha256: request.sha256,
				reservationId,
				request: null,
				uploadId: null,
				partBytes: MULTIPART_PART_BYTES,
				resume: false,
			});
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
				uploadId: null,
				paused: false,
			};
		});
		if (!added.length) {
			if (reservationId) void this.release(reservationId);
			return;
		}
		this.jobs.update((jobs) => [...jobs, ...added]);
		this.pump();
	}

	/** Tries a failed file again: a big one carries on; a small one starts again, its record dropped first. */
	retry(id: string): void {
		const job = this.find(id);
		if (!job || job.state !== 'failed') return;
		const held = this.running.get(id);
		if (held?.uploadId && job.assetId) {
			held.resume = true;
			this.patch(id, { state: 'waiting', error: null, paused: false });
			this.pump();
			return;
		}
		if (job.assetId) void this.forget(job.assetId);
		this.patch(id, { state: 'waiting', error: null, sent: 0, assetId: null, startedAt: null });
		this.pump();
	}

	/**
	 * Runs a bulk change part by part, counting as the API answers (A48). It appears in the tray only
	 * if it is still running after 0.3 s (A49). Answers what each part answered; throws the first refusal.
	 */
	async operation<T>(
		label: string,
		icon: string,
		parts: readonly number[],
		run: (index: number) => Promise<T>,
	): Promise<T[]> {
		this.counter += 1;
		const id = `op_${this.counter}`;
		const total = parts.reduce((sum, size) => sum + size, 0);
		let shown = false;
		let done = 0;
		const show = setTimeout(() => {
			shown = true;
			this.operations.update((ops) => [...ops, { id, label, icon, done, total, state: 'running', error: null }]);
		}, OPERATION_BAR_AFTER_MS);
		const patch = (changes: Partial<MediaOperation>) =>
			shown && this.operations.update((ops) => ops.map((op) => (op.id === id ? { ...op, ...changes } : op)));
		const answers: T[] = [];
		try {
			for (const [index, size] of parts.entries()) {
				answers.push(await run(index));
				done += size;
				patch({ done });
			}
			patch({ state: 'done' });
			return answers;
		} catch (error) {
			patch({
				state: 'failed',
				error: readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'),
			});
			throw error;
		} finally {
			clearTimeout(show);
		}
	}

	/** Clears finished and failed files and changes from the tray; failed uploads leave nothing behind. */
	dismiss(): void {
		this.operations.update((ops) => ops.filter((op) => op.state === 'running'));
		for (const job of this.jobs()) {
			if (job.state === 'failed' && job.assetId) void this.forget(job.assetId, job.uploadId ?? undefined);
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
		this.patch(id, { state: 'uploading', startedAt: Date.now(), paused: false });
		try {
			let assetId = job.assetId;
			if (assetId && held.uploadId) {
				// Carrying on a big upload: Spaces says which parts it already has.
				await this.sendInParts(id, held, assetId);
			} else {
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
				assetId = presigned.assetId;
				this.patch(id, { assetId, savedAs: presigned.name, sent: 0 });
				this.refreshSoon();
				if (job.bytes >= MULTIPART_FROM_BYTES) await this.sendInParts(id, held, assetId);
				else
					await this.put(
						presigned.uploadUrl,
						presigned.headers,
						held.file,
						(sent) => this.patch(id, { sent }),
						held,
					);
			}
			await lastValueFrom(this.gateway.finalizeFile(assetId, held.uploadId ?? undefined));
			this.unremember(assetId);
			this.patch(id, { state: 'done', sent: job.bytes, paused: false });
			const finished = this.find(id);
			if (finished && finished.savedAs && finished.savedAs !== finished.name) this.renamed.next(finished);
		} catch (error) {
			this.patch(id, {
				state: 'failed',
				paused: false,
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

	/**
	 * A big file (S11) in parts, three at once, each straight to Spaces. A part whose line drops is
	 * tried again after 5 s (B15). The upload is remembered in this browser, so after a reload the
	 * same file carries on from the parts Spaces already has (B16).
	 */
	private async sendInParts(id: string, held: Running, assetId: string): Promise<void> {
		const job = this.find(id);
		if (!job) return;
		if (!held.uploadId) {
			const started = await lastValueFrom(this.gateway.startMultipart(assetId));
			held.uploadId = started.uploadId;
			held.partBytes = started.partBytes;
			this.patch(id, { uploadId: started.uploadId });
		}
		const uploadId = held.uploadId;
		const size = held.partBytes;
		const count = Math.max(1, Math.ceil(held.file.size / size));
		const have = new Set<number>();
		let base = 0;
		if (held.resume) {
			const stored = await lastValueFrom(this.gateway.uploadedParts(assetId, uploadId));
			for (const part of stored.parts) {
				have.add(part.partNumber);
				base += part.size;
			}
		}
		const entry: CutOffUpload = {
			assetId,
			uploadId,
			name: job.name,
			bytes: job.bytes,
			lastModified: held.file.lastModified,
			folderId: job.folderId,
			sent: base,
		};
		this.remember(entry);
		const loaded = new Map<number, number>();
		const sentNow = () => base + [...loaded.values()].reduce((sum, bytes) => sum + bytes, 0);
		const waiting = Array.from({ length: count }, (_, index) => index + 1).filter((part) => !have.has(part));
		const sendPart = async (part: number): Promise<void> => {
			for (let attempt = 0; ; attempt += 1) {
				try {
					const { urls } = await lastValueFrom(
						this.gateway.partUrls(assetId, { uploadId, partNumbers: [part] }),
					);
					const slice = held.file.slice((part - 1) * size, Math.min(part * size, held.file.size));
					await this.put(urls[0]?.url ?? '', {}, slice, (sent) => {
						loaded.set(part, sent);
						this.patch(id, { sent: sentNow() });
					});
					loaded.set(part, slice.size);
					this.patch(id, { sent: sentNow(), paused: false });
					this.remember({ ...entry, sent: sentNow() });
					return;
				} catch (error) {
					loaded.delete(part);
					if (attempt >= PART_RETRIES) throw error;
					this.patch(id, { paused: true });
					await new Promise((settle) => setTimeout(settle, PART_RETRY_MS));
				}
			}
		};
		const lanes = Array.from({ length: Math.min(UPLOADS_AT_ONCE, waiting.length) }, async () => {
			for (let part = waiting.shift(); part !== undefined; part = waiting.shift()) await sendPart(part);
		});
		await Promise.all(lanes);
	}

	/** The bytes go straight to Spaces with the signed headers; never the admin's cookies. */
	private put(
		url: string,
		headers: Record<string, string>,
		body: Blob,
		progress: (sent: number) => void,
		held?: Running,
	): Promise<void> {
		return new Promise((done, failed) => {
			const request = new XMLHttpRequest();
			if (held) held.request = request;
			request.open('PUT', url);
			for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
			let shown = 0;
			request.upload.onprogress = (event) => {
				const now = Date.now();
				if (now - shown < PROGRESS_EVERY_MS && event.loaded < event.total) return;
				shown = now;
				progress(event.loaded);
			};
			request.onload = () =>
				request.status >= 200 && request.status < 300 ? done() : failed(new SendFailed(request.status));
			request.onerror = () => failed(new SendFailed(0));
			request.onabort = () => failed(new SendFailed(0));
			request.send(body);
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

	private async forget(assetId: string, uploadId?: string): Promise<void> {
		this.unremember(assetId);
		try {
			await lastValueFrom(this.gateway.cancelUpload(assetId, uploadId));
		} catch {
			// Already gone, or finished meanwhile.
		}
		this.refreshSoon();
	}

	// --- Cut-off big uploads (S11, B16) ----------------------------------------------------------

	private readonly saved = signal<readonly CutOffUpload[]>(this.readSaved());
	/** Big uploads cut off by a closed or reloaded tab, not running here now. */
	readonly cutOff = computed(() =>
		this.saved().filter((entry) => !this.jobs().some((job) => job.assetId === entry.assetId)),
	);

	/** Carries on with the same file: same name, size and date; anything else is refused. */
	resumeWith(entry: CutOffUpload, file: File): boolean {
		if (file.name !== entry.name || file.size !== entry.bytes || file.lastModified !== entry.lastModified)
			return false;
		this.counter += 1;
		const id = `upl_${Date.now().toString(36)}_${this.counter}`;
		this.running.set(id, {
			file,
			sha256: null,
			reservationId: null,
			request: null,
			uploadId: entry.uploadId,
			partBytes: MULTIPART_PART_BYTES,
			resume: true,
		});
		this.jobs.update((jobs) => [
			...jobs,
			{
				id,
				name: entry.name,
				savedAs: entry.name,
				bytes: entry.bytes,
				sent: entry.sent,
				contentType: file.type,
				folderId: entry.folderId,
				state: 'waiting',
				error: null,
				assetId: entry.assetId,
				startedAt: null,
				uploadId: entry.uploadId,
				paused: false,
			},
		]);
		this.pump();
		return true;
	}

	/** Gives up on a cut-off upload: its record and stored parts go. */
	discard(entry: CutOffUpload): void {
		void this.forget(entry.assetId, entry.uploadId);
	}

	private readSaved(): CutOffUpload[] {
		try {
			const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(RESUME_KEY);
			const list = raw ? (JSON.parse(raw) as unknown) : [];
			return Array.isArray(list)
				? (list as CutOffUpload[]).filter((entry) => !!entry?.assetId && !!entry.uploadId)
				: [];
		} catch {
			return [];
		}
	}

	private writeSaved(list: readonly CutOffUpload[]): void {
		this.saved.set(list);
		try {
			if (list.length) localStorage.setItem(RESUME_KEY, JSON.stringify(list));
			else localStorage.removeItem(RESUME_KEY);
		} catch {
			// A private window or blocked storage: the upload still runs; only carrying on later is lost.
		}
	}

	private remember(entry: CutOffUpload): void {
		this.writeSaved([...this.saved().filter((row) => row.assetId !== entry.assetId), entry]);
	}

	private unremember(assetId: string): void {
		if (this.saved().some((row) => row.assetId === assetId))
			this.writeSaved(this.saved().filter((row) => row.assetId !== assetId));
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
