import { TestBed } from '@angular/core/testing';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway, type EmailPictureRow } from '@core/media-library/media-library.gateway';

import { FmCleanUp, monthlyCost } from './fm-clean-up';

const row = (key: string, extra: Partial<EmailPictureRow> = {}): EmailPictureRow => ({
	key,
	assetId: 'med_gone',
	photoName: 'Red Banarasi.jpg',
	width: 300,
	bytes: 20_000,
	why: 'deleted',
	goneAt: '2026-11-16T10:00:00.000Z',
	goneBy: 'adm_1',
	goneByName: 'Moulik',
	sentCount: 0,
	lastSentAt: null,
	url: `https://cdn.test/${key}`,
	...extra,
});

const data = vi.hoisted(() => ({ value: undefined as unknown, clean: undefined as unknown, asked: [] as unknown[] }));
vi.mock('@data-access/queries/media-library.queries', async (original) => ({
	...(await original<object>()),
	injectEmailPicturesQuery: () => ({ data: () => data.value }),
	injectCleanUpQuery: (query: () => unknown) => ({
		data: () => {
			data.asked.push(query());
			return data.clean;
		},
	}),
}));

const setup = (rows: EmailPictureRow[], answer: unknown = 'yes') => {
	data.value = {
		rows,
		total: { count: rows.length, bytes: rows.length * 20_000 },
		matching: rows.length,
		next: null,
	};
	const gateway = { deleteEmailPictures: vi.fn(() => of({ deleted: 2, bytes: 40_000 })) };
	const toastr = { success: vi.fn(), error: vi.fn() };
	const modals = { open: vi.fn(() => ({ result: answer === null ? Promise.reject() : Promise.resolve(answer) })) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MediaLibraryGateway, useValue: gateway },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn(async () => undefined) } },
			{ provide: NgbModal, useValue: modals },
			{ provide: ToastrService, useValue: toastr },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(FmCleanUp, {
		set: { imports: [], template: '<ng-template #fmEmailDelete></ng-template>' },
	});
	const view = TestBed.createComponent(FmCleanUp);
	view.detectChanges();
	return { clean: view.componentInstance, gateway, toastr, modals };
};

describe('Clean up › Email pictures (A50, A51; media step 3f)', () => {
	it('picks rows one by one or all at once, and adds up what is chosen', () => {
		const { clean } = setup([row('email/a.jpg'), row('email/b.jpg', { bytes: 30_000 })]);
		clean.toggle('email/b.jpg');
		expect(clean.chosen().map((one) => one.key)).toEqual(['email/b.jpg']);
		expect(clean.chosenBytes()).toBe(30_000);
		clean.toggleAll();
		expect(clean.allPicked()).toBe(true);
		clean.toggleAll();
		expect(clean.chosen()).toEqual([]);
	});

	it('the warning counts the emails and when they were sent, once order emails exist', () => {
		const { clean } = setup([
			row('email/a.jpg', { sentCount: 4, lastSentAt: '2024-01-02T00:00:00.000Z' }),
			row('email/b.jpg', { sentCount: 9, lastSentAt: '2024-11-11T00:00:00.000Z' }),
			row('email/c.jpg'),
		]);
		clean.toggleAll();
		expect(clean.chosenEmails()).toBe(13);
		expect(clean.chosenSent()).toEqual({ from: '2024-01-02T00:00:00.000Z', to: '2024-11-11T00:00:00.000Z' });
		expect(monthlyCost(1024 ** 3)).toBeCloseTo(0.02);
	});

	it('deletes only after the warning is accepted, then starts again from the top', async () => {
		const { clean, gateway, toastr } = setup([row('email/a.jpg'), row('email/b.jpg')]);
		clean.toggleAll();
		await clean.deleteChosen();
		expect(gateway.deleteEmailPictures).toHaveBeenCalledWith(['email/a.jpg', 'email/b.jpg']);
		expect(toastr.success).toHaveBeenCalledWith('fm_email_deleted');
		expect(clean.chosen()).toEqual([]);

		const cancelled = setup([row('email/a.jpg')], null);
		cancelled.clean.toggleAll();
		await cancelled.clean.deleteChosen();
		expect(cancelled.gateway.deleteEmailPictures).not.toHaveBeenCalled();
	});

	it('a new filter starts with nothing chosen', () => {
		const { clean } = setup([row('email/a.jpg')]);
		clean.toggleAll();
		clean.setSent('over_2y');
		expect(clean.sent()).toBe('over_2y');
		expect(clean.picked().size).toBe(0);
		clean.setSent('nonsense');
		expect(clean.sent()).toBe('over_2y');
	});
});

describe('Clean up lists (A44; media step 5)', () => {
	const file = (id: string, bytes = 1000) => ({ id, name: `${id}.jpg`, bytes, location: '', kind: 'image' }) as never;
	const page = (list: string, ids: string[], total = ids.length) => ({
		list,
		rows: ids.map((id) => ({ file: file(id, 2000), uploadedAt: '2026-06-01T00:00:00.000Z', sameAs: null })),
		page: 1,
		pageSize: 50,
		total,
		counts: { unused: 3, largest: 2, duplicates: 1 },
	});

	it('starts on Not used for 90 days, asks the list of the tab chosen, and hands chosen files to Trash', () => {
		data.clean = page('unused', ['med_a', 'med_b'], 3);
		const { clean } = setup([]);
		expect(clean.tab()).toBe('unused');
		expect(clean.fileRows().map((row) => row.file.id)).toEqual(['med_a', 'med_b']);
		expect(clean.moreFiles()).toBe(true);
		clean.toggleFile('med_b');
		expect(clean.chosenFileBytes()).toBe(2000);
		const trashed: unknown[] = [];
		clean.trash.subscribe((files) => trashed.push(files));
		clean.trashChosenFiles();
		expect(trashed).toEqual([[expect.objectContaining({ id: 'med_b' })]]);
		expect(clean.filePicked().size).toBe(0);

		data.asked = [];
		data.clean = page('largest', ['med_big']);
		clean.setTab('largest');
		expect(clean.fileRows().map((row) => row.file.id)).toEqual(['med_big']);
		expect(data.asked.at(-1)).toEqual({ list: 'largest', page: 1 });
		clean.toggleAllFiles();
		expect(clean.allFilesPicked()).toBe(true);
		clean.clearFiles();
		expect(clean.chosenFiles()).toEqual([]);
		// Email pictures has its own list; the file lists show nothing there.
		clean.setTab('email');
		expect(clean.fileRows()).toEqual([]);
		data.clean = undefined;
	});
});
