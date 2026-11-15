import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from './media-library.gateway';
import { MediaUploads, PART_RETRY_MS, RESUME_KEY, UPLOADS_AT_ONCE } from './media-uploads';

/** The browser's upload request, answering with the status a test sets. */
class SentRequest {
	static status = 200;
	static sent: SentRequest[] = [];
	readonly upload: { onprogress: ((event: { loaded: number; total: number }) => void) | null } = { onprogress: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	status = 0;
	method = '';
	url = '';
	headers: Record<string, string> = {};
	body: unknown = null;
	open(method: string, url: string) {
		this.method = method;
		this.url = url;
	}
	setRequestHeader(name: string, value: string) {
		this.headers[name] = value;
	}
	send(body: Blob) {
		this.body = body;
		SentRequest.sent.push(this);
	}
	/** Finishes the upload the way the test chose. */
	finish() {
		this.upload.onprogress?.({ loaded: (this.body as Blob).size, total: (this.body as Blob).size });
		this.status = SentRequest.status;
		if (this.status) this.onload?.();
		else this.onerror?.();
	}
}

const file = (name: string, size = 10) => new File(['x'.repeat(size)], name, { type: 'application/pdf' });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the upload queue (B08, B20)', () => {
	let gateway: Record<string, ReturnType<typeof vi.fn>>;
	let uploads: MediaUploads;

	beforeEach(() => {
		SentRequest.status = 200;
		SentRequest.sent = [];
		vi.stubGlobal('XMLHttpRequest', SentRequest);
		let made = 0;
		gateway = {
			presignFile: vi.fn((body: { fileName: string }) => {
				made += 1;
				return of({
					assetId: `med_${made}`,
					name: body.fileName === 'brief.pdf' ? 'brief (1).pdf' : body.fileName,
					uploadUrl: `https://spaces.test/media/med_${made}?signed`,
					headers: { 'Content-Type': 'application/pdf', 'x-amz-acl': 'private' },
					expiresAt: '2026-11-15T12:00:00.000Z',
				});
			}),
			finalizeFile: vi.fn((id: string) => of({ assetId: id, state: 'ready' })),
			releaseHold: vi.fn(() => of(undefined)),
			cancelUpload: vi.fn(() => of(undefined)),
			startMultipart: vi.fn(() => of({ uploadId: 'up_1', partBytes: 16 * 1024 * 1024 })),
			partUrls: vi.fn((_id: string, body: { partNumbers: number[] }) =>
				of({
					urls: body.partNumbers.map((partNumber) => ({
						partNumber,
						url: `https://spaces.test/part/${partNumber}`,
					})),
				}),
			),
			uploadedParts: vi.fn(() => of({ parts: [{ partNumber: 1, size: 16 * 1024 * 1024 }] })),
		};
		localStorage.removeItem(RESUME_KEY);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: MediaLibraryGateway, useValue: gateway },
				{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		uploads = TestBed.inject(MediaUploads);
	});
	afterEach(() => vi.unstubAllGlobals());

	const request = (name: string, size = 10) => ({
		file: file(name, size),
		name,
		contentType: 'application/pdf',
		folderId: 'fld_docs',
		sha256: null,
	});

	it('sends at most three at once, straight to Spaces with the signed headers, then finishes each', async () => {
		uploads.add([request('a.pdf'), request('b.pdf'), request('c.pdf'), request('d.pdf')], 'res_1');
		await settle();
		expect(SentRequest.sent).toHaveLength(UPLOADS_AT_ONCE);
		expect(uploads.active()).toHaveLength(4);
		const first = SentRequest.sent[0] as SentRequest;
		expect(first).toMatchObject({ method: 'PUT', url: 'https://spaces.test/media/med_1?signed' });
		expect(first.headers).toEqual({ 'Content-Type': 'application/pdf', 'x-amz-acl': 'private' });
		expect(gateway['presignFile']).toHaveBeenCalledWith({
			fileName: 'a.pdf',
			contentType: 'application/pdf',
			byteSize: 10,
			folderId: 'fld_docs',
			reservationId: 'res_1',
		});
		first.finish();
		await settle();
		await settle();
		expect(gateway['finalizeFile']).toHaveBeenCalledWith('med_1', undefined);
		expect(uploads.doneCount()).toBe(1);
		// The fourth starts as soon as a line frees up.
		expect(SentRequest.sent).toHaveLength(4);
		expect(gateway['releaseHold']).not.toHaveBeenCalled();
		for (const sent of SentRequest.sent.slice(1)) sent.finish();
		await settle();
		await settle();
		expect(uploads.doneCount()).toBe(4);
		// The batch's storage approval goes back once its last file settles.
		expect(gateway['releaseHold']).toHaveBeenCalledWith('res_1');
	});

	it('says when a file kept beside one of the same name got another name (B14)', async () => {
		const renamed: string[] = [];
		uploads.renamed.subscribe((job) => renamed.push(job.savedAs ?? ''));
		uploads.add([request('brief.pdf')], null);
		await settle();
		SentRequest.sent[0]?.finish();
		await settle();
		await settle();
		expect(renamed).toEqual(['brief (1).pdf']);
	});

	it('fails a dropped line with Retry; Retry drops the unfinished record and starts again', async () => {
		SentRequest.status = 0;
		uploads.add([request('a.pdf')], null);
		await settle();
		SentRequest.sent[0]?.finish();
		await settle();
		expect(uploads.jobs()[0]).toMatchObject({
			state: 'failed',
			error: 'fm_upload_connection_lost',
			assetId: 'med_1',
		});
		expect(uploads.active()).toHaveLength(0);
		SentRequest.status = 200;
		uploads.retry(uploads.jobs()[0]?.id ?? '');
		await settle();
		expect(gateway['cancelUpload']).toHaveBeenCalledWith('med_1', undefined);
		SentRequest.sent[1]?.finish();
		await settle();
		await settle();
		expect(uploads.jobs()[0]).toMatchObject({ state: 'done', assetId: 'med_2' });
	});

	it('names the server’s refusal, and clearing the tray leaves nothing unfinished behind', async () => {
		gateway['presignFile']?.mockReturnValueOnce(
			throwError(() => ({
				error: { message: 'Photos upload on the Media page once image profiles are in place' },
			})),
		);
		uploads.add([request('a.pdf')], null);
		await settle();
		expect(uploads.jobs()[0]?.state).toBe('failed');
		SentRequest.status = 0;
		uploads.add([request('b.pdf')], null);
		await settle();
		SentRequest.sent[0]?.finish();
		await settle();
		uploads.dismiss();
		expect(uploads.jobs()).toEqual([]);
		expect(gateway['cancelUpload']).toHaveBeenCalledWith('med_1', undefined);
	});

	it('warns before the tab closes only while files are sending (S4, B09)', async () => {
		const leaving = () => {
			const event = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(event);
			return event.defaultPrevented;
		};
		expect(leaving()).toBe(false);
		uploads.add([request('a.pdf')], null);
		await settle();
		expect(leaving()).toBe(true);
		SentRequest.sent[0]?.finish();
		await settle();
		await settle();
		expect(leaving()).toBe(false);
	});

	it('gives the approval straight back when nothing was handed over', () => {
		uploads.add([], 'res_9');
		expect(gateway['releaseHold']).toHaveBeenCalledWith('res_9');
	});
});

describe('big uploads in parts (S11, B15, B16)', () => {
	const MB16 = 16 * 1024 * 1024;
	const bigFile = () =>
		new File([new Uint8Array(100 * 1024 * 1024 + 10)], 'shoot.mp4', { type: 'video/mp4', lastModified: 1700 });
	let gateway: Record<string, ReturnType<typeof vi.fn>>;
	let uploads: MediaUploads;
	const drain = async () => {
		for (let i = 0; i < 40; i += 1) {
			SentRequest.sent.filter((sent) => !sent.status).forEach((sent) => sent.finish());
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	};

	beforeEach(() => {
		SentRequest.status = 200;
		SentRequest.sent = [];
		vi.stubGlobal('XMLHttpRequest', SentRequest);
		localStorage.removeItem(RESUME_KEY);
		gateway = {
			presignFile: vi.fn(() =>
				of({
					assetId: 'med_big',
					name: 'shoot.mp4',
					uploadUrl: 'https://spaces.test/single',
					headers: {},
					expiresAt: '',
				}),
			),
			startMultipart: vi.fn(() => of({ uploadId: 'up_1', partBytes: MB16 })),
			partUrls: vi.fn((_id: string, body: { partNumbers: number[] }) =>
				of({
					urls: body.partNumbers.map((partNumber) => ({
						partNumber,
						url: `https://spaces.test/part/${partNumber}`,
					})),
				}),
			),
			uploadedParts: vi.fn(() => of({ parts: [1, 2, 3].map((partNumber) => ({ partNumber, size: MB16 })) })),
			finalizeFile: vi.fn(() => of({ assetId: 'med_big', state: 'ready' })),
			releaseHold: vi.fn(() => of(undefined)),
			cancelUpload: vi.fn(() => of(undefined)),
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: MediaLibraryGateway, useValue: gateway },
				{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		uploads = TestBed.inject(MediaUploads);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('sends a big file in 16 MB parts, remembers it while it runs, and joins the parts at the end', async () => {
		uploads.add(
			[{ file: bigFile(), name: 'shoot.mp4', contentType: 'video/mp4', folderId: null, sha256: null }],
			null,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(JSON.parse(localStorage.getItem(RESUME_KEY) ?? '[]')).toMatchObject([
			{ assetId: 'med_big', uploadId: 'up_1', bytes: 100 * 1024 * 1024 + 10 },
		]);
		await drain();
		expect(SentRequest.sent.map((sent) => sent.url)).toEqual(
			[1, 2, 3, 4, 5, 6, 7].map((part) => `https://spaces.test/part/${part}`),
		);
		expect(gateway['finalizeFile']).toHaveBeenCalledWith('med_big', 'up_1');
		expect(uploads.jobs()[0]?.state).toBe('done');
		expect(localStorage.getItem(RESUME_KEY)).toBeNull();
	});

	it('pauses a part whose line dropped and tries it again after 5 s (B15)', async () => {
		vi.useFakeTimers();
		uploads.add(
			[{ file: bigFile(), name: 'shoot.mp4', contentType: 'video/mp4', folderId: null, sha256: null }],
			null,
		);
		await vi.advanceTimersByTimeAsync(0);
		SentRequest.status = 0;
		SentRequest.sent[0]?.finish();
		await vi.advanceTimersByTimeAsync(0);
		expect(uploads.jobs()[0]?.paused).toBe(true);
		SentRequest.status = 200;
		await vi.advanceTimersByTimeAsync(PART_RETRY_MS);
		expect(SentRequest.sent.filter((sent) => sent.url.endsWith('/part/1'))).toHaveLength(2);
	});

	it('after a reload, the same file carries on from the parts Spaces has; another file is refused (B16)', async () => {
		localStorage.setItem(
			RESUME_KEY,
			JSON.stringify([
				{
					assetId: 'med_big',
					uploadId: 'up_1',
					name: 'shoot.mp4',
					bytes: 100 * 1024 * 1024 + 10,
					lastModified: 1700,
					folderId: null,
					sent: 3 * MB16,
				},
			]),
		);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: MediaLibraryGateway, useValue: gateway },
				{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		const reloaded = TestBed.inject(MediaUploads);
		const [entry] = reloaded.cutOff();
		expect(entry).toMatchObject({ name: 'shoot.mp4' });
		expect(reloaded.resumeWith(entry as never, new File(['x'], 'other.mp4'))).toBe(false);
		expect(reloaded.resumeWith(entry as never, bigFile())).toBe(true);
		expect(reloaded.cutOff()).toEqual([]);
		await drain();
		expect(gateway['presignFile']).not.toHaveBeenCalled();
		expect(gateway['uploadedParts']).toHaveBeenCalledWith('med_big', 'up_1');
		expect(SentRequest.sent.map((sent) => sent.url)).toEqual(
			[4, 5, 6, 7].map((part) => `https://spaces.test/part/${part}`),
		);
		expect(gateway['finalizeFile']).toHaveBeenCalledWith('med_big', 'up_1');
	});

	it('discarding a cut-off upload drops its record and stored parts', () => {
		localStorage.setItem(
			RESUME_KEY,
			JSON.stringify([
				{
					assetId: 'med_big',
					uploadId: 'up_1',
					name: 'shoot.mp4',
					bytes: 1,
					lastModified: 1,
					folderId: null,
					sent: 0,
				},
			]),
		);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: MediaLibraryGateway, useValue: gateway },
				{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		const reloaded = TestBed.inject(MediaUploads);
		reloaded.discard(reloaded.cutOff()[0] as never);
		expect(gateway['cancelUpload']).toHaveBeenCalledWith('med_big', 'up_1');
		expect(reloaded.cutOff()).toEqual([]);
		expect(localStorage.getItem(RESUME_KEY)).toBeNull();
	});
});
