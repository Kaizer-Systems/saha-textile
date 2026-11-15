import { webcrypto } from 'node:crypto';

import { TestBed } from '@angular/core/testing';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Subject, of, throwError } from 'rxjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';
import { MediaUploads, OPERATION_BAR_AFTER_MS } from '@core/media-library/media-uploads';
import { NotificationService } from '@data-access/services/notification.service';

import { splitSelection } from './fm-selection';
import { FmTray } from './fm-tray';
import { FmUploadFlow, type FmUploadPopups } from './fm-upload-flow';
import {
	HASH_LIMIT_BYTES,
	foldersFor,
	planUpload,
	readDropped,
	readPickedFolder,
	secondsLeft,
	sha256Hex,
	timeLeft,
	uploadPercent,
	pastedName,
	photoShapeLabel,
	versionsOf,
} from './fm-upload-plan';

const profileData = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('@data-access/queries/media-profiles.queries', async (original) => ({
	...(await original<object>()),
	injectMediaProfilesQuery: () => ({ data: () => profileData.list }),
}));

// The test page has no Web Crypto of its own; a browser on HTTPS has.
beforeAll(() => vi.stubGlobal('crypto', webcrypto));

const file = (name: string, type = 'application/pdf', size = 4) => new File(['x'.repeat(size)], name, { type });

describe('planning an upload (B03)', () => {
	it('keeps folder paths, takes JPEG and PNG as photos, lists other pictures as waiting, and leaves out what the computer left behind', () => {
		const plan = planUpload([
			{ file: file('shoot-brief.pdf'), path: ['Bridal 2027'] },
			{ file: file('cover-front.jpg', 'image/jpeg'), path: ['Bridal 2027'] },
			{ file: file('raw-dsc0099.nef', 'image/x-nikon-nef'), path: ['Bridal 2027', 'Close-ups'] },
			{ file: file('behind.mp4', 'video/mp4'), path: ['Bridal 2027', 'Video'] },
			{ file: file('.DS_Store', ''), path: ['Bridal 2027'] },
			{ file: file('._cover-front.jpg', 'image/jpeg'), path: ['Bridal 2027'] },
			{ file: file('secret.txt', 'text/plain'), path: ['Bridal 2027', '.git'] },
			{ file: file('notes', ''), path: ['Bridal 2027'] },
			{ file: file('look.webp', 'image/webp'), path: ['Bridal 2027'] },
		]);
		expect(plan.folderName).toBe('Bridal 2027');
		expect(plan.rows.map((row) => [row.name, row.waits, row.photo])).toEqual([
			['shoot-brief.pdf', false, false],
			['cover-front.jpg', false, true],
			['raw-dsc0099.nef', false, false],
			['behind.mp4', false, false],
			['notes', false, false],
			['look.webp', true, false],
		]);
		// A browser that knows no type still sends one the API takes.
		expect(plan.rows[4]?.contentType).toBe('application/octet-stream');
		expect(foldersFor(plan.rows)).toEqual([
			['Bridal 2027'],
			['Bridal 2027', 'Close-ups'],
			['Bridal 2027', 'Video'],
		]);
	});

	it('names no folder when loose files or several folders are picked', () => {
		expect(planUpload([{ file: file('a.pdf'), path: [] }]).folderName).toBeNull();
		expect(
			planUpload([
				{ file: file('a.pdf'), path: ['One'] },
				{ file: file('b.pdf'), path: ['Two'] },
			]).folderName,
		).toBeNull();
	});

	it('reads a picked folder by its relative paths', () => {
		const picked = file('zari.pdf');
		Object.defineProperty(picked, 'webkitRelativePath', { value: 'Bridal 2027/Close-ups/zari.pdf' });
		expect(readPickedFolder([picked])).toEqual([{ file: picked, path: ['Bridal 2027', 'Close-ups'] }]);
	});

	it('reads a dropped folder to the bottom, batch by batch', async () => {
		const leaf = (name: string) => ({
			isFile: true,
			isDirectory: false,
			name,
			file: (done: (f: File) => void) => done(file(name)),
		});
		const folder = (name: string, batches: unknown[][]) => ({
			isFile: false,
			isDirectory: true,
			name,
			createReader: () => {
				let call = 0;
				return { readEntries: (done: (entries: unknown[]) => void) => done(batches[call++] ?? []) };
			},
		});
		const dropped = await readDropped([
			{ webkitGetAsEntry: () => leaf('loose.pdf') },
			{ webkitGetAsEntry: () => folder('Bridal', [[leaf('a.pdf')], [folder('Inner', [[leaf('b.pdf')]])]]) },
		]);
		expect(dropped.map((item) => [item.file.name, item.path])).toEqual([
			['loose.pdf', []],
			['a.pdf', ['Bridal']],
			['b.pdf', ['Bridal', 'Inner']],
		]);
	});

	it('counts SHA-256 in the browser, but not for a file too big to read whole', async () => {
		expect(await sha256Hex(new Blob(['abc']))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
		const huge = { size: HASH_LIMIT_BYTES + 1 } as Blob;
		expect(await sha256Hex(huge)).toBeNull();
	});

	it('shows percent and time left from the speed so far', () => {
		expect(uploadPercent({ sent: 64, bytes: 100 })).toBe(64);
		expect(uploadPercent({ sent: 0, bytes: 0 })).toBe(100);
		expect(secondsLeft(50, 100, 10_000)).toBe(10);
		expect(secondsLeft(0, 100, 10_000)).toBeNull();
		expect(timeLeft(9)).toEqual({ key: 'fm_seconds_left', count: 9 });
		expect(timeLeft(240)).toEqual({ key: 'fm_minutes_left', count: 4 });
	});
});

describe('the upload flow: popup, duplicates, storage, folders (B03, B10, B11, B18, B19)', () => {
	const popups = {
		review: {},
		duplicate: {},
		onDemand: {},
		refused: {},
		overLimit: { name: 'over' },
		notes: { name: 'notes' },
	} as unknown as FmUploadPopups;
	const setup = (
		options: {
			duplicates?: unknown[];
			storage?: unknown[];
			answers?: (string | null)[];
		} = {},
	) => {
		const storageAnswers = [...(options.storage ?? [{ decision: 'go', reservationId: 'res_1' }])];
		const modalAnswers = [...(options.answers ?? [])];
		let made = 0;
		const gateway = {
			duplicates: vi.fn((query: { files: { name: string }[] }) =>
				of({
					files: query.files.map(
						(item, index) =>
							(options.duplicates?.[index] as object | undefined) ?? {
								name: item.name,
								identical: null,
								sameName: null,
								keepBothName: item.name,
							},
					),
				}),
			),
			checkStorage: vi.fn(() => of(storageAnswers.shift())),
			createFolder: vi.fn((body: { name: string }) => of({ id: `fld_${++made}_${body.name}` })),
			releaseHold: vi.fn(() => of(undefined)),
		};
		const modals = {
			open: vi.fn(() => {
				const answer = modalAnswers.shift();
				return {
					result:
						answer === null || answer === undefined ? Promise.reject('closed') : Promise.resolve(answer),
				};
			}),
		};
		const uploads = { add: vi.fn() };
		const notifications = { showError: vi.fn(), showSuccess: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				FmUploadFlow,
				{ provide: MediaLibraryGateway, useValue: gateway },
				{ provide: NgbModal, useValue: modals },
				{ provide: NotificationService, useValue: notifications },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
				{ provide: MediaUploads, useValue: uploads },
			],
		});
		return { flow: TestBed.inject(FmUploadFlow), gateway, modals, uploads, notifications };
	};
	const folderPlan = () =>
		planUpload([
			{ file: file('brief.pdf'), path: [] },
			{ file: file('catalogue.zip', 'application/zip'), path: [] },
			{ file: file('cover.jpg', 'image/jpeg'), path: [] },
			{ file: file('inner.pdf'), path: ['Bridal 2027', 'Close-ups'] },
		]);

	it('lists everything, sends only ticked non-photos, and makes the folders parents first', async () => {
		const { flow, gateway, uploads } = setup();
		flow.open(folderPlan(), 'fld_b', 'My files › Banarasi', popups);
		// The JPEG is a photo now; with no size read here (no decoder in the test browser) it does not go yet.
		expect(flow.waiting()).toBe(0);
		expect(flow.photos().map((row) => row.name)).toEqual(['cover.jpg']);
		expect(flow.going().map((row) => row.name)).toEqual(['brief.pdf', 'catalogue.zip', 'inner.pdf']);
		expect(flow.foldersToMake()).toBe(2);
		flow.toggleRow(flow.going()[1]?.key ?? '');
		const close = vi.fn();
		await flow.start(close, popups);
		expect(close).toHaveBeenCalled();
		expect(gateway.duplicates).toHaveBeenCalledWith({
			folderId: 'fld_b',
			files: [
				{ name: 'brief.pdf', bytes: 4, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
				{ name: 'inner.pdf', bytes: 4, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
			],
		});
		expect(gateway.checkStorage).toHaveBeenCalledWith({ operation: 'upload', bytes: 8, approve: false });
		expect(gateway.createFolder.mock.calls.map((call) => call[0])).toEqual([
			{ name: 'Bridal 2027', parentId: 'fld_b' },
			{ name: 'Close-ups', parentId: 'fld_1_Bridal 2027' },
		]);
		expect(uploads.add).toHaveBeenCalledWith(
			[
				expect.objectContaining({ name: 'brief.pdf', folderId: 'fld_b' }),
				expect.objectContaining({ name: 'inner.pdf', folderId: 'fld_2_Close-ups' }),
			],
			'res_1',
		);
		expect(flow.review()).toBeNull();
	});

	it('asks about the same bytes and the same name; “Use the existing one” leaves a file out (B10, B11)', async () => {
		const { flow, uploads, modals } = setup({
			duplicates: [
				{
					name: 'brief.pdf',
					identical: { id: 'med_9', name: 'brief.pdf', location: 'Documents' },
					sameName: null,
					keepBothName: 'brief (1).pdf',
				},
				{
					name: 'catalogue.zip',
					identical: null,
					sameName: { id: 'med_8', name: 'catalogue.zip' },
					keepBothName: 'catalogue (1).zip',
				},
				// Going into a folder the upload makes: no neighbours, so the same name does not count.
				{
					name: 'inner.pdf',
					identical: null,
					sameName: { id: 'med_7', name: 'inner.pdf' },
					keepBothName: 'inner (1).pdf',
				},
			],
			// The first answer is the upload popup's own; then one per question.
			answers: ['review', 'existing', 'upload'],
		});
		flow.open(folderPlan(), 'fld_b', 'Banarasi', popups);
		await flow.start(vi.fn(), popups);
		expect(modals.open).toHaveBeenCalledTimes(3);
		expect(uploads.add.mock.calls[0]?.[0].map((row: { name: string }) => row.name)).toEqual([
			'catalogue.zip',
			'inner.pdf',
		]);
	});

	it('“Same answer for the others” answers the rest of that kind without asking', async () => {
		const same = (name: string) => ({
			name,
			identical: { id: 'med_1', name, location: '' },
			sameName: null,
			keepBothName: name,
		});
		const { flow, uploads, modals } = setup({
			duplicates: [same('a.pdf'), same('b.pdf'), same('c.pdf')],
			answers: ['existing'],
		});
		flow.open(
			planUpload(['a.pdf', 'b.pdf', 'c.pdf'].map((name) => ({ file: file(name), path: [] }))),
			null,
			'My files',
			popups,
		);
		modals.open.mockImplementationOnce(() => {
			const ask = flow.duplicate();
			expect(ask).toMatchObject({ kind: 'identical', others: 2 });
			flow.duplicate.set({ ...(ask as NonNullable<typeof ask>), sameForOthers: true });
			return { result: Promise.resolve('existing') };
		});
		await flow.start(vi.fn(), popups);
		expect(modals.open).toHaveBeenCalledTimes(2);
		expect(uploads.add).not.toHaveBeenCalled();
	});

	it('closing a duplicate question stops the whole upload', async () => {
		const { flow, uploads, gateway } = setup({
			duplicates: [
				{
					name: 'a.pdf',
					identical: { id: 'med_1', name: 'a.pdf', location: '' },
					sameName: null,
					keepBothName: 'a (1).pdf',
				},
			],
			answers: [null],
		});
		flow.open(planUpload([{ file: file('a.pdf'), path: [] }]), null, 'My files', popups);
		await flow.start(vi.fn(), popups);
		expect(gateway.checkStorage).not.toHaveBeenCalled();
		expect(uploads.add).not.toHaveBeenCalled();
	});

	it('past the plan asks a super admin, and a yes runs under the approval with “also let others” (B18)', async () => {
		const ask = {
			decision: 'ask',
			reservationId: null,
			usedBytes: 1,
			afterBytes: 2,
			onDemandBytes: 1,
			onDemandMonthlyUsd: 0.01,
			canApprove: true,
		};
		const { flow, gateway, uploads } = setup({
			storage: [ask, { ...ask, decision: 'go', reservationId: 'res_od' }],
			answers: ['yes'],
		});
		flow.open(planUpload([{ file: file('a.pdf'), path: [] }]), null, 'My files', popups);
		vi.spyOn(TestBed.inject(NgbModal), 'open').mockImplementation(() => {
			flow.alsoLetOthers.set(true);
			return { result: Promise.resolve('yes') } as never;
		});
		await flow.start(vi.fn(), popups);
		expect(gateway.checkStorage).toHaveBeenLastCalledWith({
			operation: 'upload',
			bytes: 4,
			approve: true,
			alsoLetOthers: true,
		});
		expect(uploads.add).toHaveBeenCalledWith(expect.any(Array), 'res_od');
	});

	it('an admin not allowed past the plan is told, and nothing uploads (B19)', async () => {
		const refused = {
			decision: 'refused',
			reservationId: null,
			usedBytes: 1,
			afterBytes: 2,
			onDemandBytes: 1,
			onDemandMonthlyUsd: 0.01,
			canApprove: false,
		};
		const { flow, uploads, modals } = setup({ storage: [refused], answers: ['review', 'ok'] });
		flow.open(planUpload([{ file: file('a.pdf'), path: [] }]), null, 'My files', popups);
		await flow.start(vi.fn(), popups);
		// The upload popup, then the refusal.
		expect(modals.open).toHaveBeenCalledTimes(2);
		expect(flow.storageAsk()).toMatchObject({ decision: 'refused', files: 1, bytes: 4 });
		expect(uploads.add).not.toHaveBeenCalled();
	});

	it('break-it: a folder that cannot be made gives the approval back and uploads nothing', async () => {
		const { flow, gateway, uploads, notifications } = setup();
		gateway.createFolder.mockReturnValueOnce(throwError(() => new Error('down')));
		flow.open(planUpload([{ file: file('a.pdf'), path: ['New'] }]), null, 'My files', popups);
		await flow.start(vi.fn(), popups);
		expect(notifications.showError).toHaveBeenCalledWith('fm_action_failed');
		expect(gateway.releaseHold).toHaveBeenCalledWith('res_1');
		expect(uploads.add).not.toHaveBeenCalled();
	});

	it('a photo whose size cannot be read here has nothing to send: Upload does nothing', async () => {
		const { flow, gateway } = setup();
		flow.open(planUpload([{ file: file('a.jpg', 'image/jpeg'), path: [] }]), null, 'My files', popups);
		expect(flow.going()).toEqual([]);
		await flow.start(vi.fn(), popups);
		expect(gateway.duplicates).not.toHaveBeenCalled();
	});
});

describe('the upload tray head', () => {
	it('counts what is running, failed and done, then says how many uploaded', () => {
		const jobs = (states: string[]) => states.map((state, index) => ({ id: `u${index}`, state }));
		const uploads = {
			jobs: vi.fn(),
			active: vi.fn(() => [] as unknown[]),
			runningOperations: vi.fn(() => [] as unknown[]),
			doneCount: vi.fn(() => 0),
			failedCount: vi.fn(() => 0),
			renamed: new Subject(),
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: MediaUploads, useValue: uploads },
				{ provide: ToastrService, useValue: { success: vi.fn() } },
				{
					provide: TranslocoService,
					useValue: {
						translate: (key: string, params?: { count?: string }) => `${key}:${params?.count ?? ''}`,
						getActiveLang: () => 'en',
						getTranslation: () => ({}),
					},
				},
			],
		});
		TestBed.overrideComponent(FmTray, { set: { imports: [], template: '' } });
		const tray = TestBed.createComponent(FmTray).componentInstance;
		uploads.active.mockReturnValue(jobs(['uploading', 'waiting']));
		uploads.doneCount.mockReturnValue(3);
		uploads.failedCount.mockReturnValue(1);
		expect(tray.head()).toBe('fm_tray_uploading_other:2 · fm_tray_failed_other:1 · fm_tray_done_other:3');
	});
});

describe('bulk changes in the tray (A48, A49)', () => {
	const service = () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: MediaLibraryGateway, useValue: {} },
				{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		return TestBed.inject(MediaUploads);
	};

	it('splits a big selection into parts, folders first', () => {
		const parts = splitSelection({ folderIds: ['f1', 'f2'], fileIds: ['a', 'b', 'c'] }, 2);
		expect(parts).toEqual([
			{ folderIds: ['f1', 'f2'], fileIds: [] },
			{ folderIds: [], fileIds: ['a', 'b'] },
			{ folderIds: [], fileIds: ['c'] },
		]);
		expect(splitSelection({ folderIds: [], fileIds: [] })).toEqual([]);
	});

	it('shows no bar for a change done within 0.3 s', async () => {
		const uploads = service();
		const answers = await uploads.operation('Renamed', 'ri-edit-line', [1], async () => 'ok');
		expect(answers).toEqual(['ok']);
		expect(uploads.operations()).toEqual([]);
	});

	it('counts a slow change part by part, then marks it done; a refusal marks it failed', async () => {
		vi.useFakeTimers();
		const uploads = service();
		let release: () => void = () => undefined;
		const running = uploads.operation('Moving 3 files', 'ri-drag-move-2-line', [2, 1], (index) =>
			index === 0 ? new Promise<number>((done) => (release = () => done(0))) : Promise.resolve(1),
		);
		await vi.advanceTimersByTimeAsync(OPERATION_BAR_AFTER_MS + 10);
		expect(uploads.operations()[0]).toMatchObject({ done: 0, total: 3, state: 'running' });
		release();
		await vi.runAllTimersAsync();
		await running;
		expect(uploads.operations()[0]).toMatchObject({ done: 3, total: 3, state: 'done' });
		const failing = uploads.operation('Deleting', 'ri-delete-bin-2-line', [1], async () => {
			await new Promise((done) => setTimeout(done, 500));
			throw new Error('down');
		});
		const caught = failing.catch(() => 'refused');
		await vi.runAllTimersAsync();
		expect(await caught).toBe('refused');
		expect(uploads.operations()[1]).toMatchObject({ state: 'failed', error: 'fm_action_failed' });
		uploads.dismiss();
		expect(uploads.operations()).toEqual([]);
		vi.useRealTimers();
	});
});

describe('photos in the upload popup (media step 2d: B01, B02, B02b, B04, B05, B17, B21)', () => {
	const profile = (key: string, extra: Record<string, unknown> = {}) => ({
		key,
		name: key,
		builtIn: true,
		shape: { width: 3, height: 4 },
		roles: ['card'],
		widths: { card: [400] },
		quality: null,
		fills: ['white', 'blur', 'crop'],
		minSize: { edge: 'short', px: 1600, mode: 'refuse' },
		maxBytes: 25 * 1024 * 1024,
		accepts: ['image/jpeg', 'image/png'],
		mainPhotoOnly: false,
		enabled: true,
		version: 1,
		...extra,
	});
	const PROFILES = [
		profile('product_3x4'),
		profile('hero_21x9', {
			shape: { width: 21, height: 9 },
			fills: ['crop', 'blur', 'colour'],
			minSize: { edge: 'width', px: 2560, mode: 'warn' },
		}),
		profile('link_preview', { mainPhotoOnly: true }),
		profile('square_1x1', { enabled: false, shape: { width: 1, height: 1 } }),
	];
	const photo = (name: string) => new File([new Uint8Array(4)], name, { type: 'image/jpeg' });
	const POPUPS = {
		review: {},
		duplicate: {},
		onDemand: {},
		refused: {},
		overLimit: { name: 'over' },
		notes: { name: 'notes' },
	} as unknown as FmUploadPopups;

	const run = async (sizes: Record<string, { width: number; height: number }>, files: File[]) => {
		profileData.list = PROFILES.map((entry) => ({ profile: entry, photos: 0 }));
		vi.stubGlobal('createImageBitmap', async (blob: File) => ({ ...sizes[blob.name], close: () => undefined }));
		const answers: unknown[] = [];
		const modals = {
			open: vi.fn((template: { name?: string }) => {
				answers.push(template?.name ?? 'review');
				return { result: template?.name ? Promise.resolve('yes') : new Promise(() => undefined) };
			}),
		};
		const uploads = { add: vi.fn() };
		const gateway = {
			duplicates: vi.fn(() =>
				of({ files: files.map(() => ({ identical: null, sameName: null, keepBothName: '' })) }),
			),
			checkStorage: vi.fn(() => of({ decision: 'go', reservationId: 'res_1' })),
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				FmUploadFlow,
				{ provide: MediaLibraryGateway, useValue: gateway },
				{ provide: NgbModal, useValue: modals },
				{ provide: NotificationService, useValue: { showError: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
				{ provide: MediaUploads, useValue: uploads },
			],
		});
		const flow = TestBed.inject(FmUploadFlow);
		flow.open(planUpload(files.map((entry) => ({ file: entry, path: [] }))), 'fld_1', 'Banarasi', POPUPS);
		await vi.waitFor(() => expect(flow.reading()).toBe(0));
		return { flow, uploads, answers };
	};

	it('a same-name photo uploaded anyway can replace the one there, asking first when it is used (B12, B13, step 3b)', async () => {
		const sizes = { 'front.jpg': { width: 3000, height: 4000 } };
		profileData.list = PROFILES.map((entry) => ({ profile: entry, photos: 0 }));
		vi.stubGlobal('createImageBitmap', async (blob: File) => ({
			...sizes[blob.name as 'front.jpg'],
			close: () => undefined,
		}));
		const asked: string[] = [];
		const setup = (choice: 'keep' | 'replace') => {
			let flow: FmUploadFlow | null = null;
			const modals = {
				open: vi.fn((template: { name?: string }) => {
					const name = template?.name ?? 'review';
					asked.push(name);
					if (name === 'anyway') flow?.anywayChoice.set(choice);
					const answer = { duplicate: 'upload', anyway: 'go', replaceInUse: 'yes' }[name];
					return { result: answer ? Promise.resolve(answer) : new Promise(() => undefined) };
				}),
			};
			const uploads = { add: vi.fn(), replacePhoto: vi.fn(async () => undefined) };
			const gateway = {
				duplicates: vi.fn(() =>
					of({
						files: [
							{
								identical: null,
								sameName: { id: 'med_old', name: 'front.jpg' },
								keepBothName: 'front (1).jpg',
							},
						],
					}),
				),
				details: vi.fn(() => of({ usedOn: ['product · Red Banarasi Silk'] })),
				checkStorage: vi.fn(() => of({ decision: 'go', reservationId: 'res_1' })),
			};
			TestBed.resetTestingModule();
			TestBed.configureTestingModule({
				providers: [
					FmUploadFlow,
					{ provide: MediaLibraryGateway, useValue: gateway },
					{ provide: NgbModal, useValue: modals },
					{ provide: NotificationService, useValue: { showError: vi.fn() } },
					{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
					{ provide: MediaUploads, useValue: uploads },
				],
			});
			flow = TestBed.inject(FmUploadFlow);
			return { flow, uploads };
		};
		const popups = {
			...POPUPS,
			duplicate: { name: 'duplicate' },
			anyway: { name: 'anyway' },
			replaceInUse: { name: 'replaceInUse' },
		} as unknown as FmUploadPopups;

		const replacing = setup('replace');
		replacing.flow.open(planUpload([{ file: photo('front.jpg'), path: [] }]), 'fld_1', 'Banarasi', popups);
		await vi.waitFor(() => expect(replacing.flow.reading()).toBe(0));
		await replacing.flow.start(vi.fn(), popups);
		expect(asked).toEqual(['review', 'duplicate', 'anyway', 'replaceInUse']);
		expect(replacing.flow.replaceInUse()).toEqual({ name: 'front.jpg', places: ['product · Red Banarasi Silk'] });
		expect(replacing.uploads.replacePhoto).toHaveBeenCalledWith(
			expect.objectContaining({
				fileId: 'med_old',
				name: 'front.jpg',
				request: expect.objectContaining({ width: 3000, height: 4000, reservationId: 'res_1' }),
			}),
		);
		expect(replacing.uploads.add).not.toHaveBeenCalled();

		asked.length = 0;
		const keeping = setup('keep');
		keeping.flow.open(planUpload([{ file: photo('front.jpg'), path: [] }]), 'fld_1', 'Banarasi', popups);
		await vi.waitFor(() => expect(keeping.flow.reading()).toBe(0));
		await keeping.flow.start(vi.fn(), popups);
		expect(asked).toEqual(['review', 'duplicate', 'anyway']);
		expect(keeping.uploads.replacePhoto).not.toHaveBeenCalled();
		expect(keeping.uploads.add).toHaveBeenCalledTimes(1);
	});

	it('suggests a profile from each photo’s shape, offers only switched-on chosen profiles, and sends versions', async () => {
		const { flow, uploads } = await run({ 'front.jpg': { width: 3000, height: 4000 } }, [photo('front.jpg')]);
		expect(flow.profiles().map((entry) => entry.key)).toEqual(['product_3x4', 'hero_21x9']);
		const row = flow.review()?.rows[0];
		expect(row?.picks).toEqual([{ profileKey: 'product_3x4', fills: ['as_is'] }]);
		expect(flow.going()).toHaveLength(1);
		await flow.start(vi.fn(), POPUPS);
		expect(uploads.add).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					name: 'front.jpg',
					photo: { width: 3000, height: 4000, versions: [{ profileKey: 'product_3x4', fill: 'as_is' }] },
				}),
			],
			'res_1',
		);
	});

	it('ticks a different-shape profile with its first fill, adds fills side by side, never leaves none (B21)', async () => {
		const { flow } = await run({ 'wide.jpg': { width: 4800, height: 2400 } }, [photo('wide.jpg')]);
		const key = flow.review()?.rows[0]?.key as string;
		expect(flow.review()?.rows[0]?.picks).toEqual([]);
		flow.togglePick(key, 'product_3x4');
		flow.toggleFill(key, 'product_3x4', 'blur');
		expect(flow.review()?.rows[0]?.picks).toEqual([{ profileKey: 'product_3x4', fills: ['white', 'blur'] }]);
		flow.toggleFill(key, 'product_3x4', 'white');
		flow.toggleFill(key, 'product_3x4', 'blur');
		expect(flow.review()?.rows[0]?.picks[0]?.fills).toEqual(['blur']);
		expect(flow.notesFor(flow.review()?.rows[0] as never).map((note) => note.kind)).toEqual(['shape']);
	});

	it('the bar adds or removes a profile on every ticked photo; refusals stop a photo, notes ask first (B02b, B05)', async () => {
		const { flow, uploads, answers } = await run(
			{ 'a.jpg': { width: 1800, height: 2400 }, 'small.jpg': { width: 900, height: 1200 } },
			[photo('a.jpg'), photo('small.jpg')],
		);
		flow.bulkProfile.set('hero_21x9');
		flow.bulk('add');
		const [a, small] = flow.review()?.rows ?? [];
		expect(flow.isPicked(a as never, 'hero_21x9')).toBe(true);
		expect(flow.notesFor(a as never).map((note) => note.kind)).toEqual(['small', 'shape']);
		// The small photo is refused by Product 3:4 (1600 px short side): it does not go.
		expect(flow.notesFor(small as never).some((note) => note.kind === 'too_small')).toBe(true);
		expect(flow.going().map((row) => row.name)).toEqual(['a.jpg']);
		expect(flow.noted().map((row) => row.name)).toEqual(['a.jpg']);
		await flow.start(vi.fn(), POPUPS);
		expect(answers).toContain('notes');
		expect(uploads.add.mock.calls[0]?.[0][0].photo.versions).toEqual([
			{ profileKey: 'product_3x4', fill: 'as_is' },
			{ profileKey: 'hero_21x9', fill: 'crop' },
		]);
		flow.bulk('remove');
	});
});

describe('photo helpers', () => {
	it('names a pasted picture and a photo’s shape', () => {
		expect(pastedName('image/png', new Date(2026, 10, 15, 10, 32))).toBe('pasted-image-15-nov-2026-10-32.png');
		expect(pastedName('image/jpeg', new Date(2026, 0, 2, 9, 5))).toBe('pasted-image-2-jan-2026-09-05.jpg');
		expect(photoShapeLabel({ width: 3000, height: 4000 })).toBe('3:4');
		expect(photoShapeLabel({ width: 4800, height: 2400 })).toBe('2:1');
		expect(photoShapeLabel({ width: 2721, height: 805 })).toBe('3.38:1');
		expect(versionsOf({ picks: [{ profileKey: 'p', fills: ['white', 'blur'] }] })).toEqual([
			{ profileKey: 'p', fill: 'white' },
			{ profileKey: 'p', fill: 'blur' },
		]);
	});
});
