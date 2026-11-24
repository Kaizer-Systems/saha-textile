import { webcrypto } from 'node:crypto';

import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { type Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';
import { NotificationService } from '@data-access/services/notification.service';

import { FmUploadFlow, type FmUploadPopups } from './fm-upload-flow';
import { type FmUploadRow, PHOTO_MAX_BYTES, planUpload } from './fm-upload-plan';

const h = vi.hoisted(() => ({
	profiles: undefined as unknown[] | undefined,
	heic: vi.fn<(file: File) => Promise<File>>(),
}));
vi.mock('@data-access/queries/media-profiles.queries', async (original) => ({
	...(await original<object>()),
	injectMediaProfilesQuery: () => ({ data: () => h.profiles }),
}));
vi.mock('@core/media-library/heic', () => ({ heicToJpeg: (file: File) => h.heic(file) }));

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
const PROFILES = [profile('product_3x4'), profile('square_1x1', { shape: { width: 1, height: 1 } })];

const POPUPS = {
	review: { name: 'review' },
	duplicate: { name: 'duplicate' },
	onDemand: { name: 'onDemand' },
	refused: { name: 'refused' },
	overLimit: { name: 'over' },
	notes: { name: 'notes' },
	anyway: { name: 'anyway' },
	replaceInUse: { name: 'replaceInUse' },
} as unknown as FmUploadPopups;

const storage = (decision: 'go' | 'ask' | 'refused', extra: Record<string, unknown> = {}) => ({
	decision,
	reservationId: decision === 'go' ? 'res_1' : null,
	usedBytes: 0,
	afterBytes: 0,
	onDemandBytes: 0,
	onDemandMonthlyUsd: 0,
	canApprove: false,
	...extra,
});

const file = (name: string, type = 'application/pdf') => new File([new Uint8Array(4)], name, { type });
const row = (name: string, type = 'application/pdf', path: string[] = []): FmUploadRow =>
	planUpload([{ file: file(name, type), path }]).rows[0] as FmUploadRow;
const sized = (
	name: string,
	size = { width: 3000, height: 4000 },
	picks = [{ profileKey: 'product_3x4', fills: ['as_is'] }],
) => ({ ...row(name, 'image/jpeg'), key: name, size, sizeRead: true, picks }) as FmUploadRow;

interface Options {
	answers?: Record<string, unknown>;
	storage?: unknown[];
	duplicates?: (query: { files: { name: string }[] }) => Observable<unknown>;
	createFolder?: () => Observable<unknown>;
	details?: () => Observable<unknown>;
	onOpen?: (name: string, flow: FmUploadFlow) => void;
	review?: Promise<unknown>;
}

function setup(options: Options = {}) {
	const answers = [...(options.storage ?? [storage('go')])];
	const gateway = {
		duplicates: vi.fn(
			options.duplicates ??
				((query: { files: { name: string }[] }) =>
					of({
						files: query.files.map((item) => ({
							name: item.name,
							identical: null,
							sameName: null,
							keepBothName: item.name,
						})),
					})),
		),
		checkStorage: vi.fn(() => {
			const next = answers.shift();
			return next instanceof Error ? throwError(() => next) : of(next);
		}),
		createFolder: vi.fn(options.createFolder ?? (() => of({ id: 'fld_new' }))),
		releaseHold: vi.fn(() => throwError(() => new Error('gone'))),
		details: vi.fn(options.details ?? (() => of({ usedOn: [] }))),
	};
	const opened: string[] = [];
	let flow: FmUploadFlow | null = null;
	const modals = {
		open: vi.fn((template: { name: string }) => {
			opened.push(template.name);
			options.onOpen?.(template.name, flow as FmUploadFlow);
			if (template.name === 'review') return { result: options.review ?? new Promise(() => undefined) };
			const answer = options.answers?.[template.name];
			return { result: answer ? Promise.resolve(answer) : Promise.reject(new Error('closed')) };
		}),
	};
	const uploads = { add: vi.fn(), replacePhoto: vi.fn(async () => undefined) };
	const notifications = { showError: vi.fn() };
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
	flow = TestBed.inject(FmUploadFlow);
	return { flow, gateway, modals, opened, uploads, notifications };
}

/** Puts rows straight into the popup, as if their sizes had been read. */
function review(flow: FmUploadFlow, rows: FmUploadRow[], targetId: string | null = 'fld_1') {
	flow.review.set({
		plan: { rows, folderName: null },
		rows,
		skipped: new Set(),
		targetId,
		place: 'Banarasi',
		checking: false,
		asked: null,
	});
}

const savedUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

beforeEach(() => {
	h.profiles = PROFILES.map((entry) => ({ profile: entry, photos: 0 }));
	h.heic.mockReset();
	vi.stubGlobal('crypto', webcrypto);
	vi.stubGlobal('createImageBitmap', async (blob: File) => ({
		...({ 'look.jpg': { width: 3000, height: 4000 } } as Record<string, object>)[blob.name],
		close: () => undefined,
	}));
	URL.createObjectURL = vi.fn(() => 'blob:thumb');
	URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
	vi.unstubAllGlobals();
	URL.createObjectURL = savedUrl.create;
	URL.revokeObjectURL = savedUrl.revoke;
});

describe('the upload flow: the last cases', () => {
	it('holds nothing before a popup opens, and an empty pick opens none', () => {
		h.profiles = undefined;
		const { flow, modals } = setup();
		expect(flow.profiles()).toEqual([]);
		expect([flow.going(), flow.photos(), flow.overLimit()]).toEqual([[], [], []]);
		expect([flow.waiting(), flow.goingFiles(), flow.goingBytes()]).toEqual([0, 0, 0]);
		flow.togglePick('a', 'product_3x4');
		flow.toggleRow('a');
		flow.toggleAll(true);
		flow.removeRow('a');
		expect(flow.review()).toBeNull();
		flow.open({ rows: [], folderName: null }, 'fld_1', 'Banarasi', POPUPS);
		expect(flow.review()).toBeNull();
		expect(modals.open).not.toHaveBeenCalled();
	});

	it('reads a HEIC as the JPEG made from it, keeps a camera RAW as a file, and lets the previews go on close', async () => {
		h.heic.mockResolvedValue(new File([new Uint8Array(8)], 'look.jpg', { type: 'image/jpeg' }));
		let close!: (value: unknown) => void;
		const { flow } = setup({ review: new Promise((done) => (close = done)) });
		flow.open(
			planUpload([
				{ file: file('look.heic', 'image/heic'), path: [] },
				{ file: file('dsc0099.nef', 'image/x-nikon-nef'), path: [] },
			]),
			'fld_1',
			'Banarasi',
			POPUPS,
		);
		await vi.waitFor(() => expect(flow.reading()).toBe(0));
		const [heic, raw] = flow.review()?.rows ?? [];
		expect(heic).toMatchObject({ name: 'look.jpg', contentType: 'image/jpeg', kind: 'jpeg', bytes: 8 });
		expect(heic?.source?.name).toBe('look.heic');
		expect(heic?.size).toEqual({ width: 3000, height: 4000 });
		expect(raw?.photo).toBe(false);
		expect(flow.thumb(heic?.key ?? '')).toBe('blob:thumb');
		expect(flow.goingFiles()).toBe(1);
		expect(flow.goingBytes()).toBe(12);
		close('done');
		await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb'));
		expect(flow.thumb(heic?.key ?? '')).toBeNull();
	});

	it('a HEIC it cannot turn into a JPEG has no size, and no preview is made where the browser cannot make one', async () => {
		h.heic.mockRejectedValueOnce(new Error('no decoder'));
		const failing = setup();
		failing.flow.open(planUpload([{ file: file('look.heic', 'image/heic'), path: [] }]), 'fld_1', 'B', POPUPS);
		await vi.waitFor(() => expect(failing.flow.reading()).toBe(0));
		expect(failing.flow.review()?.rows[0]).toMatchObject({
			name: 'look.heic',
			size: null,
			sizeRead: true,
			picks: [],
		});

		(URL as { createObjectURL?: unknown }).createObjectURL = undefined;
		h.heic.mockResolvedValueOnce(new File([new Uint8Array(8)], 'look.jpg', { type: 'image/jpeg' }));
		const bare = setup();
		bare.flow.open(planUpload([{ file: file('look.heic', 'image/heic'), path: [] }]), 'fld_1', 'B', POPUPS);
		await vi.waitFor(() => expect(bare.flow.reading()).toBe(0));
		const made = bare.flow.review()?.rows[0];
		expect(made?.name).toBe('look.jpg');
		expect(bare.flow.thumb(made?.key ?? '')).toBeNull();
	});

	it('reads no sizes when the popup closed while the bytes were checked', async () => {
		const { flow } = setup();
		flow.open(planUpload([{ file: file('look.jpg', 'image/jpeg'), path: [] }]), 'fld_1', 'B', POPUPS);
		expect(flow.reading()).toBe(1);
		flow.review.set(null);
		await vi.waitFor(() => expect(flow.reading()).toBe(0));
		expect(flow.review()).toBeNull();
	});

	it('a file waiting for image profiles never goes; notes and fills read each photo', () => {
		const { flow } = setup();
		const waits = row('sketch.xcf', 'image/x-xcf');
		const pdf = row('brief.pdf');
		const photo = sized('front.jpg');
		review(flow, [waits, pdf, photo]);
		expect(flow.waiting()).toBe(1);
		expect(flow.going().map((entry) => entry.name)).toEqual(['brief.pdf', 'front.jpg']);
		expect(flow.notesFor(pdf)).toEqual([]);
		expect(flow.hasFill(photo, 'product_3x4', 'as_is')).toBe(true);
		expect(flow.hasFill(photo, 'square_1x1', 'crop')).toBe(false);
	});

	it('ticks and unticks profiles and fills, one photo or all of them', () => {
		const { flow } = setup();
		const unsized = { ...row('later.jpg', 'image/jpeg'), key: 'later.jpg' };
		review(flow, [
			sized('a.jpg'),
			sized('b.jpg', undefined, []),
			sized('skip.jpg', undefined, []),
			unsized,
			row('brief.pdf'),
		]);
		flow.toggleRow('skip.jpg');
		const picks = (key: string) => flow.review()?.rows.find((entry) => entry.key === key)?.picks;

		flow.togglePick('later.jpg', 'product_3x4');
		flow.togglePick('a.jpg', 'gone');
		expect(picks('later.jpg')).toEqual([]);
		expect(picks('a.jpg')).toEqual([{ profileKey: 'product_3x4', fills: ['as_is'] }]);

		flow.togglePick('a.jpg', 'square_1x1');
		flow.toggleFill('a.jpg', 'square_1x1', 'crop');
		expect(picks('a.jpg')).toEqual([
			{ profileKey: 'product_3x4', fills: ['as_is'] },
			{ profileKey: 'square_1x1', fills: [expect.any(String), 'crop'] },
		]);
		flow.togglePick('a.jpg', 'square_1x1');
		expect(picks('a.jpg')).toEqual([{ profileKey: 'product_3x4', fills: ['as_is'] }]);

		flow.bulkProfile.set('product_3x4');
		flow.bulk('add');
		expect(picks('b.jpg')).toEqual([{ profileKey: 'product_3x4', fills: ['as_is'] }]);
		expect(picks('a.jpg')).toEqual([{ profileKey: 'product_3x4', fills: ['as_is'] }]);
		expect(picks('skip.jpg')).toEqual([]);
		flow.togglePick('a.jpg', 'product_3x4');
		flow.bulk('remove');
		expect([picks('a.jpg'), picks('b.jpg')]).toEqual([[], []]);
	});

	it('the head box ticks every row that can go, or none; a row can be ticked again or taken out', () => {
		const { flow } = setup();
		review(flow, [row('brief.pdf'), row('sketch.xcf', 'image/x-xcf')]);
		const [pdf, waits] = flow.review()?.rows ?? [];
		flow.toggleRow(pdf?.key ?? '');
		flow.toggleRow(pdf?.key ?? '');
		expect(flow.review()?.skipped.size).toBe(0);
		flow.toggleAll(false);
		expect([...(flow.review()?.skipped ?? [])]).toEqual([pdf?.key]);
		flow.toggleAll(true);
		expect(flow.review()?.skipped.size).toBe(0);
		flow.removeRow(waits?.key ?? '');
		expect(flow.review()?.rows.map((entry) => entry.name)).toEqual(['brief.pdf']);
	});

	it('stops when the over-25 MB list or the notes list is closed', async () => {
		const big = { ...sized('big.jpg'), bytes: PHOTO_MAX_BYTES + 1 };
		const over = setup();
		review(over.flow, [big, row('brief.pdf')]);
		await over.flow.start(vi.fn(), POPUPS);
		expect(over.opened).toEqual(['over']);
		expect(over.gateway.duplicates).not.toHaveBeenCalled();

		const notes = setup({ answers: { over: 'yes' } });
		review(notes.flow, [big, sized('square.jpg', { width: 3000, height: 3000 }), row('brief.pdf')]);
		expect(notes.flow.noted().map((entry) => entry.name)).toEqual(['square.jpg']);
		await notes.flow.start(vi.fn(), POPUPS);
		expect(notes.opened).toEqual(['over', 'notes']);
		expect(notes.gateway.duplicates).not.toHaveBeenCalled();
	});

	it('a failed duplicate check says why and closes the popup', async () => {
		const { flow, notifications, uploads } = setup({ duplicates: () => throwError(() => new Error('down')) });
		review(flow, [row('brief.pdf')]);
		const close = vi.fn();
		await flow.start(close, POPUPS);
		expect(notifications.showError).toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		expect(uploads.add).not.toHaveBeenCalled();
		expect(flow.review()).toBeNull();
	});

	it('lets the storage hold go when a folder cannot be made, even if letting go fails', async () => {
		const failing = () => throwError(() => new Error('taken'));
		const held = setup({ createFolder: failing });
		review(held.flow, [row('inner.pdf', 'application/pdf', ['New'])]);
		await held.flow.start(vi.fn(), POPUPS);
		expect(held.gateway.releaseHold).toHaveBeenCalledWith('res_1');
		expect(held.uploads.add).not.toHaveBeenCalled();
		expect(held.notifications.showError).toHaveBeenCalled();

		const free = setup({ createFolder: failing, storage: [storage('go', { reservationId: null })] });
		review(free.flow, [row('inner.pdf', 'application/pdf', ['New'])], null);
		await free.flow.start(vi.fn(), POPUPS);
		expect(free.gateway.releaseHold).not.toHaveBeenCalled();
	});

	it('keeps a file the check said nothing about, and one uploaded beside its exact copy', async () => {
		const quiet = setup({ duplicates: () => of({ files: [] }) });
		review(quiet.flow, [row('brief.pdf')]);
		await quiet.flow.start(vi.fn(), POPUPS);
		expect(quiet.uploads.add).toHaveBeenCalledWith([expect.objectContaining({ name: 'brief.pdf' })], 'res_1');

		const copy = setup({
			answers: { duplicate: 'upload' },
			duplicates: () =>
				of({
					files: [
						{
							name: 'brief.pdf',
							identical: { id: 'med_1', name: 'brief.pdf', location: 'My files' },
							sameName: null,
							keepBothName: 'brief (1).pdf',
						},
					],
				}),
		});
		review(copy.flow, [row('brief.pdf')]);
		await copy.flow.start(vi.fn(), POPUPS);
		expect(copy.opened).toEqual(['duplicate']);
		expect(copy.uploads.add).toHaveBeenCalledWith([expect.objectContaining({ name: 'brief.pdf' })], 'res_1');
	});

	describe('a photo uploaded beside one of the same name (B12, B13)', () => {
		const sameName = () =>
			of({
				files: [
					{
						name: 'front.jpg',
						identical: null,
						sameName: { id: 'med_old', name: 'front.jpg' },
						keepBothName: 'front (1).jpg',
					},
					{ name: 'brief.pdf', identical: null, sameName: null, keepBothName: 'brief.pdf' },
				],
			});
		const replacing = (name: string, flow: FmUploadFlow) => {
			if (name === 'anyway') flow.anywayChoice.set('replace');
		};
		const rows = () => [sized('front.jpg'), row('brief.pdf')];

		it('uploads nothing when the question is closed', async () => {
			const { flow, uploads } = setup({ answers: { duplicate: 'upload' }, duplicates: sameName });
			review(flow, rows());
			await flow.start(vi.fn(), POPUPS);
			expect(uploads.add).not.toHaveBeenCalled();
			expect(uploads.replacePhoto).not.toHaveBeenCalled();
		});

		it('uploads nothing when the photo to replace cannot be read', async () => {
			const { flow, uploads, notifications } = setup({
				answers: { duplicate: 'upload', anyway: 'go' },
				duplicates: sameName,
				details: () => throwError(() => new Error('gone')),
				onOpen: replacing,
			});
			review(flow, rows());
			await flow.start(vi.fn(), POPUPS);
			expect(notifications.showError).toHaveBeenCalledWith('fm_action_failed');
			expect(uploads.replacePhoto).not.toHaveBeenCalled();
		});

		it('uploads nothing when “Replace everywhere” is closed', async () => {
			const { flow, uploads, opened } = setup({
				answers: { duplicate: 'upload', anyway: 'go' },
				duplicates: sameName,
				details: () => of({ usedOn: ['product · Red Banarasi Silk'] }),
				onOpen: replacing,
			});
			review(flow, rows());
			await flow.start(vi.fn(), POPUPS);
			expect(opened).toEqual(['duplicate', 'anyway', 'replaceInUse']);
			expect(uploads.replacePhoto).not.toHaveBeenCalled();
		});

		it('replaces a photo used nowhere without asking again, with no hash or hold when there is none', async () => {
			vi.stubGlobal('crypto', {});
			const { flow, uploads, opened, gateway } = setup({
				answers: { duplicate: 'upload', anyway: 'go' },
				duplicates: sameName,
				onOpen: replacing,
				storage: [storage('go', { reservationId: null })],
			});
			review(flow, rows());
			await flow.start(vi.fn(), POPUPS);
			expect(opened).toEqual(['duplicate', 'anyway']);
			expect(gateway.duplicates).toHaveBeenCalledWith({
				folderId: 'fld_1',
				files: [
					{ name: 'front.jpg', bytes: 4 },
					{ name: 'brief.pdf', bytes: 4 },
				],
			});
			expect(uploads.replacePhoto).toHaveBeenCalledWith(
				expect.objectContaining({
					fileId: 'med_old',
					request: {
						fileName: 'front.jpg',
						contentType: 'image/jpeg',
						byteSize: 4,
						width: 3000,
						height: 4000,
					},
				}),
			);
			expect(uploads.add).toHaveBeenCalledWith(
				[expect.objectContaining({ name: 'brief.pdf', sha256: null })],
				null,
			);
		});
	});

	describe('the storage check (B18, B19)', () => {
		const ask = (flow: FmUploadFlow) => flow.storageCheck('upload', 10, 1, null, POPUPS);

		it('stops when the first check fails', async () => {
			const { flow, notifications } = setup({ storage: [new Error('down')] });
			expect(await ask(flow)).toBe(false);
			expect(notifications.showError).toHaveBeenCalled();
		});

		it('stops when the on-demand question is closed', async () => {
			const { flow } = setup({ storage: [storage('ask')] });
			expect(await ask(flow)).toBe(false);
			expect(flow.storageAsk()).toMatchObject({ decision: 'ask', bytes: 10, files: 1, operation: 'upload' });
		});

		it('an admin who cannot let others use on-demand storage approves for themselves only', async () => {
			const { flow, gateway } = setup({
				answers: { onDemand: 'yes' },
				storage: [storage('ask'), storage('go', { reservationId: 'res_2' })],
			});
			expect(await ask(flow)).toBe('res_2');
			expect(gateway.checkStorage).toHaveBeenLastCalledWith({ operation: 'upload', bytes: 10, approve: true });
		});

		it('stops when the approval fails, or is refused after all', async () => {
			const failing = setup({
				answers: { onDemand: 'yes' },
				storage: [storage('ask', { canApprove: true }), new Error('down')],
			});
			expect(await ask(failing.flow)).toBe(false);
			expect(failing.gateway.checkStorage).toHaveBeenLastCalledWith({
				operation: 'upload',
				bytes: 10,
				approve: true,
				alsoLetOthers: false,
			});

			const refused = setup({ answers: { onDemand: 'yes' }, storage: [storage('ask'), storage('refused')] });
			expect(await ask(refused.flow)).toBe(false);
			expect(refused.opened).toEqual(['onDemand', 'refused']);
			expect(refused.flow.storageAsk()?.decision).toBe('refused');
		});
	});
});
