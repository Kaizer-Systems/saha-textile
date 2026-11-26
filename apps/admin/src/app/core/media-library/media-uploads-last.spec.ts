import { TestBed } from '@angular/core/testing';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from './media-library.gateway';
import { MAKING_GIVE_UP_MS, MAKING_POLL_MS, MediaUploads, PART_RETRY_MS, RESUME_KEY } from './media-uploads';

/** The browser's upload request; a test finishes each one with the status it wants. */
class SentRequest {
	static sent: SentRequest[] = [];
	readonly upload: { onprogress: ((event: { loaded: number; total: number }) => void) | null } = { onprogress: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	status = 0;
	url = '';
	body: Blob | null = null;
	open(_method: string, url: string) {
		this.url = url;
	}
	setRequestHeader() {
		return undefined;
	}
	send(body: Blob) {
		this.body = body;
		SentRequest.sent.push(this);
	}
	answer(status: number) {
		this.status = status;
		this.onload?.();
	}
}

const file = (name: string, size = 10) => new File(['x'.repeat(size)], name, { type: 'image/jpeg' });
const flush = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

function make(over: Record<string, unknown> = {}) {
	const gateway: Record<string, ReturnType<typeof vi.fn>> = {
		presignFile: vi.fn(() =>
			of({ assetId: 'med_1', name: 'a.jpg', uploadUrl: 'https://spaces.test/a', headers: {}, expiresAt: '' }),
		),
		finalizeFile: vi.fn((id: string) => of({ assetId: id, state: 'ready' })),
		releaseHold: vi.fn(() => of(undefined)),
		cancelUpload: vi.fn(() => of(undefined)),
		startMultipart: vi.fn(() => of({ uploadId: 'up_1', partBytes: 4 })),
		partUrls: vi.fn(() => of({ urls: [] })),
		uploadedParts: vi.fn(() => of({ parts: [] })),
		photoStatus: vi.fn(() => of({ state: 'ready', error: null })),
		versionsStatus: vi.fn(() => of({ photos: 1, making: 0, failed: 0 })),
		zip: vi.fn(() => of({ id: 'zip_1', state: 'ready', files: { done: 1, total: 1 }, bytes: { total: 10 } })),
		zips: vi.fn(() => of({ zips: [] })),
		zipLink: vi.fn(() => of(null)),
		cancelZip: vi.fn(() => of(undefined)),
		startReplace: vi.fn(() => of({ uploadUrl: 'https://spaces.test/r', headers: {}, expiresAt: '' })),
		finishReplace: vi.fn(() => of({ places: 1 })),
		replaceStatus: vi.fn(() => of({ phase: 'done', made: 1, total: 1, error: null, places: 1 })),
		cancelReplace: vi.fn(() => of(undefined)),
		setFocal: vi.fn(() => of({ phase: 'making' })),
		...over,
	};
	const toastr = { error: vi.fn(), success: vi.fn() };
	const invalidateQueries = vi.fn(async () => undefined);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MediaLibraryGateway, useValue: gateway },
			{ provide: QueryClient, useValue: { invalidateQueries } },
			{ provide: ToastrService, useValue: toastr },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: Record<string, unknown>) =>
						params ? `${key}(${Object.values(params).join(',')})` : key,
					getActiveLang: () => 'en',
					getTranslation: () => ({}),
				},
			},
		],
	});
	return { uploads: TestBed.inject(MediaUploads), gateway, toastr, invalidateQueries };
}

/** Reads the service's private parts, to set up a state the public calls reach only with large files. */
const inside = (uploads: MediaUploads) =>
	uploads as unknown as {
		running: Map<string, { uploadId: string | null; resume: boolean }>;
		run(id: string): Promise<void>;
		sendInParts(id: string, held: unknown, assetId: string): Promise<void>;
	};

beforeEach(() => {
	SentRequest.sent = [];
	vi.stubGlobal('XMLHttpRequest', SentRequest);
	localStorage.removeItem(RESUME_KEY);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	localStorage.removeItem(RESUME_KEY);
});

describe('the upload queue: the last cases', () => {
	it('counts running changes and failed files, and an empty batch gives nothing back without an approval', () => {
		const { uploads, gateway } = make();
		expect(uploads.runningOperations()).toEqual([]);
		expect(uploads.failedCount()).toBe(0);
		uploads.add([], null);
		expect(gateway['releaseHold']).not.toHaveBeenCalled();
		uploads.retry('nope');
		expect(uploads.jobs()).toEqual([]);
	});

	it('retries a failed big file from its parts, and a failed small file that was never stored from the start', async () => {
		const { uploads } = make({ presignFile: vi.fn(() => throwError(() => new Error('down'))) });
		uploads.add(
			[{ file: file('a.jpg'), name: 'a.jpg', contentType: 'image/jpeg', folderId: null, sha256: null }],
			null,
		);
		await flush();
		const [job] = uploads.jobs();
		expect(job?.state).toBe('failed');
		uploads.retry(job!.id);
		expect(uploads.jobs()[0]?.state).not.toBe('waiting');
		await flush();
		const id = uploads.jobs()[0]!.id;
		inside(uploads).running.get(id)!.uploadId = 'up_1';
		uploads.jobs.update((jobs) => jobs.map((row) => ({ ...row, state: 'failed', assetId: 'med_9' })));
		const run = vi.spyOn(inside(uploads), 'run').mockResolvedValue(undefined);
		uploads.retry(id);
		expect(inside(uploads).running.get(id)!.resume).toBe(true);
		expect(uploads.jobs()[0]?.state).toBe('waiting');
		expect(run).toHaveBeenCalledWith(id);
	});

	it('sends the photo’s fingerprint and details, then waits for its versions: failed, then ready, then given up', async () => {
		vi.useFakeTimers();
		const photoStatus = vi
			.fn()
			.mockReturnValueOnce(throwError(() => new Error('down')))
			.mockReturnValueOnce(of({ state: 'failed', error: undefined }));
		const { uploads, gateway } = make({ photoStatus });
		const photo = { width: 3000, height: 4000 };
		uploads.add(
			[
				{
					file: file('a.jpg'),
					name: 'a.jpg',
					contentType: 'image/jpeg',
					folderId: null,
					sha256: 'abc',
					photo,
				} as never,
			],
			null,
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(gateway['presignFile']).toHaveBeenCalledWith(expect.objectContaining({ sha256: 'abc', width: 3000 }));
		SentRequest.sent[0]!.answer(200);
		await vi.advanceTimersByTimeAsync(0);
		expect(uploads.jobs()[0]?.state).toBe('making');
		await vi.advanceTimersByTimeAsync(MAKING_POLL_MS * 2);
		expect(uploads.jobs()[0]).toMatchObject({ state: 'failed', error: 'fm_versions_failed()' });
		photoStatus.mockReturnValue(of({ state: 'making' }));
		uploads.add(
			[
				{
					file: file('b.jpg'),
					name: 'b.jpg',
					contentType: 'image/jpeg',
					folderId: null,
					sha256: null,
					photo,
				} as never,
			],
			null,
		);
		await vi.advanceTimersByTimeAsync(0);
		SentRequest.sent[1]!.answer(200);
		await vi.advanceTimersByTimeAsync(MAKING_GIVE_UP_MS + MAKING_POLL_MS);
		expect(uploads.jobs()[1]?.state).toBe('done');
	});

	it('a send the storage refuses, or one aborted, fails the file; progress is shown at most five times a second', async () => {
		const { uploads } = make();
		uploads.add(
			[{ file: file('a.jpg'), name: 'a.jpg', contentType: 'image/jpeg', folderId: null, sha256: null }],
			null,
		);
		await flush();
		const sent = SentRequest.sent[0]!;
		sent.upload.onprogress?.({ loaded: 2, total: 10 });
		sent.upload.onprogress?.({ loaded: 4, total: 10 });
		expect(uploads.jobs()[0]?.sent).toBe(2);
		sent.answer(403);
		await flush();
		expect(uploads.jobs()[0]).toMatchObject({ state: 'failed', error: 'fm_upload_connection_lost' });
		uploads.add(
			[{ file: file('b.jpg'), name: 'b.jpg', contentType: 'image/jpeg', folderId: null, sha256: null }],
			null,
		);
		await flush();
		SentRequest.sent[1]!.onabort?.();
		await flush();
		expect(uploads.jobs()[1]?.state).toBe('failed');
	});

	it('clearing the tray keeps the files still waiting, and the progress map leaves out finished files', () => {
		const { uploads } = make();
		uploads.jobs.set([
			{ id: 'a', state: 'waiting', assetId: 'med_a' },
			{ id: 'b', state: 'done', assetId: 'med_b' },
			{ id: 'c', state: 'uploading', assetId: null },
		] as never);
		expect([...uploads.byAsset().keys()]).toEqual(['med_a']);
		uploads.dismiss();
		expect(uploads.jobs().map((job) => job.id)).toEqual(['a', 'c']);
	});

	it('a file that left the queue is not sent', async () => {
		const { uploads, gateway } = make();
		await inside(uploads).run('gone');
		await inside(uploads).sendInParts('gone', {}, 'med_x');
		expect(gateway['presignFile']).not.toHaveBeenCalled();
		expect(gateway['startMultipart']).not.toHaveBeenCalled();
	});

	it('a part with no address is sent nowhere and tried again until it gives up', async () => {
		vi.useFakeTimers();
		const { uploads, gateway } = make();
		uploads.jobs.set([
			{ id: 'big', name: 'big.mov', state: 'uploading', bytes: 4, folderId: null, assetId: 'med_big' },
		] as never);
		const held = { file: file('big.mov', 4), uploadId: null, partBytes: 4, resume: false, request: null };
		const sending = inside(uploads)
			.sendInParts('big', held, 'med_big')
			.catch((error: unknown) => error);
		for (let i = 0; i < 4; i++) {
			await vi.advanceTimersByTimeAsync(0);
			const last = SentRequest.sent.at(-1);
			expect(last?.url).toBe('');
			last?.onerror?.();
			await vi.advanceTimersByTimeAsync(PART_RETRY_MS);
		}
		expect(await sending).toBeInstanceOf(Error);
		expect(gateway['partUrls']).toHaveBeenCalledTimes(4);
	});
});

describe('changes in the tray: the last cases', () => {
	it('versions after Reprocess: nothing to follow, an answer missing, counts missing, and giving up', async () => {
		vi.useFakeTimers();
		const versionsStatus = vi
			.fn()
			.mockReturnValueOnce(throwError(() => new Error('down')))
			.mockReturnValueOnce(of({ photos: 1 }));
		const { uploads } = make({ versionsStatus });
		uploads.watchVersions('none', []);
		expect(uploads.operations()).toEqual([]);
		uploads.watchVersions('one', ['med_1']);
		await vi.advanceTimersByTimeAsync(MAKING_POLL_MS * 2);
		expect(uploads.operations()[0]?.state).toBe('done');
		versionsStatus.mockReturnValue(of({ photos: 1, making: 1, failed: 0 }));
		uploads.watchVersions('slow', ['med_2']);
		await vi.advanceTimersByTimeAsync(MAKING_GIVE_UP_MS + MAKING_POLL_MS);
		expect(uploads.operations()[1]?.state).toBe('done');
	});

	it('a zip: followed once, Cancel asks the worker, a missed answer waits, and a link that is gone says so', async () => {
		vi.useFakeTimers();
		const zip = vi
			.fn()
			.mockReturnValueOnce(throwError(() => new Error('down')))
			.mockReturnValue(of({ id: 'zip_1', state: 'ready', files: { done: 1, total: 1 }, bytes: { total: 10 } }));
		const { uploads, gateway, toastr } = make({ zip });
		const made = {
			id: 'zip_1',
			name: 'photos.zip',
			state: 'adding',
			files: { done: 0, total: 1 },
			bytes: { total: 0 },
		};
		uploads.watchZip(made as never);
		uploads.watchZip(made as never);
		expect(uploads.operations()).toHaveLength(1);
		uploads.operations()[0]?.action?.run();
		expect(gateway['cancelZip']).toHaveBeenCalledWith('zip_1');
		await vi.advanceTimersByTimeAsync(MAKING_POLL_MS * 2);
		await flush();
		expect(uploads.operations()[0]?.state).toBe('done');
		expect(toastr.error).toHaveBeenCalledWith('fm_zip_link_gone');
		uploads.dismissOperation('zip_zip_1');
		expect(uploads.operations()).toEqual([]);
	});

	it('picks up the zips still being made after a reload, and none when the list cannot be read', async () => {
		const zips = vi
			.fn()
			.mockReturnValueOnce(throwError(() => new Error('down')))
			.mockReturnValueOnce(
				of({
					zips: [
						{ id: 'z1', name: 'a.zip', state: 'adding', files: { done: 0, total: 1 }, bytes: { total: 0 } },
						{ id: 'z2', name: 'b.zip', state: 'ready', files: { done: 1, total: 1 }, bytes: { total: 1 } },
					],
				}),
			);
		const { uploads } = make({ zips, zip: vi.fn(() => new Subject()) });
		await uploads.resumeZips();
		expect(uploads.operations()).toEqual([]);
		await uploads.resumeZips();
		expect(uploads.operations().map((op) => op.id)).toEqual(['zip_z1']);
	});

	it('Replace: a missed answer, a count not planned yet, a failure with no reason, and giving up', async () => {
		vi.useFakeTimers();
		const replaceStatus = vi
			.fn()
			.mockReturnValueOnce(throwError(() => new Error('down')))
			.mockReturnValueOnce(of({ phase: 'making', made: 0, total: 0, places: 2 }))
			.mockReturnValueOnce(of({ phase: 'failed', made: 0, total: 0, places: 2, error: undefined }));
		const { uploads, gateway } = make({ replaceStatus });
		const request = { fileName: 'x.jpg', contentType: 'image/jpeg', byteSize: 10, width: 1, height: 1 };
		const running = uploads.replacePhoto({ fileId: 'med_r', name: 'red.jpg', file: file('x.jpg'), request });
		await vi.advanceTimersByTimeAsync(0);
		SentRequest.sent[0]!.answer(200);
		await vi.advanceTimersByTimeAsync(MAKING_POLL_MS * 3);
		await running;
		expect(uploads.replaces().get('med_r')).toMatchObject({
			step: 'failed',
			error: 'fm_rp_failed_reason(red.jpg,)',
			total: 0,
		});
		expect(gateway['cancelReplace']).toHaveBeenCalledWith('med_r');
		replaceStatus.mockReturnValue(of({ phase: 'making', made: 1, total: 2, places: 2 }));
		const slow = uploads.replacePhoto({ fileId: 'med_s', name: 'slow.jpg', file: file('x.jpg'), request });
		await vi.advanceTimersByTimeAsync(0);
		SentRequest.sent[1]!.answer(200);
		await vi.advanceTimersByTimeAsync(MAKING_GIVE_UP_MS + MAKING_POLL_MS);
		await slow;
		expect(uploads.replaces().get('med_s')?.step).toBe('done');
	});

	it('a new focal point: kept at once without Crop versions, else followed to done, failed or given up', async () => {
		vi.useFakeTimers();
		const replaceStatus = vi
			.fn()
			.mockReturnValueOnce(throwError(() => new Error('down')))
			.mockReturnValueOnce(of({ phase: 'done' }))
			.mockReturnValueOnce(of({ phase: 'failed', error: undefined }))
			.mockReturnValue(of({ phase: 'making' }));
		const setFocal = vi
			.fn()
			.mockReturnValueOnce(of({ phase: 'done' }))
			.mockReturnValue(of({ phase: 'making' }));
		const { uploads, invalidateQueries } = make({ replaceStatus, setFocal });
		expect(await uploads.refocus('med_1', 'a.jpg', { x: 0.5, y: 0.5 })).toBe(true);
		const done = uploads.refocus('med_1', 'a.jpg', null);
		await vi.advanceTimersByTimeAsync(MAKING_POLL_MS * 2);
		expect(await done).toBe(true);
		expect(invalidateQueries).toHaveBeenCalled();
		const failed = uploads.followRename('med_2', 'b.jpg');
		await vi.advanceTimersByTimeAsync(MAKING_POLL_MS);
		expect(await failed).toBe(false);
		expect(uploads.operations().find((op) => op.id === 'fn_med_2')?.error).toBe('fm_rp_failed_reason(b.jpg,)');
		const slow = uploads.followRename('med_3', 'c.jpg');
		await vi.advanceTimersByTimeAsync(MAKING_GIVE_UP_MS + MAKING_POLL_MS);
		expect(await slow).toBe(true);
		expect(uploads.operations().find((op) => op.id === 'fn_med_3')?.state).toBe('done');
	});

	it('Bring older versions up to date: a missed check, still running, then failed or done, or given up', async () => {
		vi.useFakeTimers();
		const { uploads } = make();
		const poll = vi
			.fn()
			.mockRejectedValueOnce(new Error('down'))
			.mockResolvedValueOnce({ running: 2, failed: 0 })
			.mockResolvedValueOnce({ running: 0, failed: 1 });
		const failed = uploads.followRefresh('Product 3:4', 4, poll);
		await vi.advanceTimersByTimeAsync(MAKING_POLL_MS * 3);
		await failed;
		expect(uploads.operations()[0]).toMatchObject({
			state: 'failed',
			error: 'profile_refresh_failed(Product 3:4,1)',
		});
		const done = uploads.followRefresh('Hero', 1, async () => ({ running: 0, failed: 0 }));
		await vi.advanceTimersByTimeAsync(MAKING_POLL_MS);
		await done;
		expect(uploads.operations().find((op) => op.id === 'pr_Hero')?.state).toBe('done');
		const slow = uploads.followRefresh('Slow', 1, async () => ({ running: 1, failed: 0 }));
		await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + MAKING_POLL_MS);
		await slow;
		expect(uploads.operations().find((op) => op.id === 'pr_Slow')?.state).toBe('done');
	});
});

describe('the queue: lists with rows in them, and calls that fail on the way out', () => {
	it('counts running changes and failed files among others', () => {
		const { uploads } = make();
		uploads.operations.set([
			{ id: 'a', state: 'running' },
			{ id: 'b', state: 'done' },
		] as never);
		uploads.jobs.set([
			{ id: 'x', state: 'failed' },
			{ id: 'y', state: 'done' },
		] as never);
		expect([uploads.runningOperations().length, uploads.failedCount()]).toEqual([1, 1]);
	});

	it('a zip Cancel and a zip link that fail, and Replace cancels that fail, all stay quiet', async () => {
		vi.useFakeTimers();
		const cancelZip = vi.fn(() => throwError(() => new Error('down')));
		const zipLink = vi.fn(() => throwError(() => new Error('down')));
		const cancelReplace = vi.fn(() => throwError(() => new Error('down')));
		const replaceStatus = vi.fn(() => of({ phase: 'failed', made: 0, total: 0, places: 0, error: 'x' }));
		const { uploads, toastr } = make({ cancelZip, zipLink, cancelReplace, replaceStatus });
		uploads.watchZip({
			id: 'z',
			name: 'a.zip',
			state: 'adding',
			files: { done: 0, total: 1 },
			bytes: { total: 0 },
		} as never);
		uploads.operations()[0]?.action?.run();
		await vi.advanceTimersByTimeAsync(MAKING_POLL_MS);
		await flush();
		expect(toastr.error).toHaveBeenCalledWith('fm_zip_link_gone');
		const request = { fileName: 'x.jpg', contentType: 'image/jpeg', byteSize: 10, width: 1, height: 1 };
		const refused = uploads.replacePhoto({ fileId: 'med_a', name: 'a.jpg', file: file('x.jpg'), request });
		await vi.advanceTimersByTimeAsync(0);
		SentRequest.sent[0]!.answer(500);
		await refused;
		expect(uploads.replaces().get('med_a')?.step).toBe('failed');
		const remade = uploads.replacePhoto({ fileId: 'med_b', name: 'b.jpg', file: file('x.jpg'), request });
		await vi.advanceTimersByTimeAsync(0);
		SentRequest.sent[1]!.answer(200);
		await vi.advanceTimersByTimeAsync(MAKING_POLL_MS);
		await remade;
		const renamed = uploads.followRename('med_c', 'c.jpg');
		await vi.advanceTimersByTimeAsync(MAKING_POLL_MS);
		expect(await renamed).toBe(false);
		expect(cancelReplace).toHaveBeenCalledTimes(3);
	});

	it('a photo whose versions are ready finishes', async () => {
		vi.useFakeTimers();
		const { uploads } = make();
		uploads.add(
			[
				{
					file: file('a.jpg'),
					name: 'a.jpg',
					contentType: 'image/jpeg',
					folderId: null,
					sha256: null,
					photo: { width: 1, height: 1 },
				} as never,
			],
			null,
		);
		await vi.advanceTimersByTimeAsync(0);
		SentRequest.sent[0]!.answer(200);
		await vi.advanceTimersByTimeAsync(MAKING_POLL_MS);
		expect(uploads.jobs()[0]?.state).toBe('done');
	});
});

describe('cut-off uploads kept in this browser: the last cases', () => {
	it('reads nothing from a broken or odd record', () => {
		localStorage.setItem(RESUME_KEY, '{not json');
		expect(make().uploads.cutOff()).toEqual([]);
		localStorage.setItem(RESUME_KEY, JSON.stringify({ assetId: 'med_1' }));
		expect(make().uploads.cutOff()).toEqual([]);
	});
});
