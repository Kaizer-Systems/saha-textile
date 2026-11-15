import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from './media-library.gateway';
import { MediaUploads, UPLOADS_AT_ONCE } from './media-uploads';

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
		expect(gateway['finalizeFile']).toHaveBeenCalledWith('med_1');
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
		expect(gateway['cancelUpload']).toHaveBeenCalledWith('med_1');
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
		expect(gateway['cancelUpload']).toHaveBeenCalledWith('med_1');
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
