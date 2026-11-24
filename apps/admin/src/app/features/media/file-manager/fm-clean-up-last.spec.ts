import { TestBed } from '@angular/core/testing';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway, type EmailPictureRow } from '@core/media-library/media-library.gateway';

import { FmCleanUp } from './fm-clean-up';

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

const data = vi.hoisted(() => ({
	value: undefined as unknown,
	clean: undefined as unknown,
	asked: [] as unknown[],
	email: null as null | (() => unknown),
}));
vi.mock('@data-access/queries/media-library.queries', async (original) => ({
	...(await original<object>()),
	injectEmailPicturesQuery: (query: () => unknown) => {
		data.email = query;
		return { data: () => data.value };
	},
	injectCleanUpQuery: (query: () => unknown) => ({
		data: () => {
			data.asked.push(query());
			return data.clean;
		},
	}),
}));

const setup = (
	rows: EmailPictureRow[],
	answer: unknown = 'yes',
	template = '<ng-template #fmEmailDelete></ng-template>',
) => {
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
		set: { imports: [], template },
	});
	const view = TestBed.createComponent(FmCleanUp);
	view.detectChanges();
	return { clean: view.componentInstance, gateway, toastr, modals };
};

const fileRow = (id: string) => ({ file: { id, name: `${id}.pdf`, bytes: 10 }, lastUsedAt: null });

describe('Clean up: the last cases', () => {
	it('file lists: the email tab asks for nothing of its own, more rows add up, and ticks come and go', () => {
		data.clean = { list: 'unused', rows: [fileRow('a'), fileRow('b')], total: 4 };
		const { clean } = setup([]);
		clean.setTab('email');
		expect(clean.moreFiles()).toBe(false);
		expect(data.asked.at(-1)).toMatchObject({ list: 'unused' });
		expect(clean.fileRows()).toEqual([]);
		clean.setTab('unused');
		expect(clean.fileRows()).toHaveLength(2);
		clean.moreFileRows();
		expect(clean.filePage()).toBe(2);
		expect(clean.fileRows()).toHaveLength(2);
		clean.toggleFile('a');
		clean.toggleFile('a');
		expect(clean.filePicked().size).toBe(0);
		clean.toggleAllFiles();
		expect(clean.allFilesPicked()).toBe(true);
		clean.toggleAllFiles();
		expect(clean.filePicked().size).toBe(0);
		clean.filePicked.set(new Set(['never-seen']));
		expect(clean.chosenFiles()).toEqual([]);
		clean.trashChosenFiles();
		expect(clean.filePage()).toBe(2);
		data.clean = undefined;
	});

	it('email pictures: pages on, keeps ticks of rows it has seen, and nothing before the list', () => {
		const { clean } = setup([row('email/a.jpg')]);
		expect(data.email?.()).toEqual({ sent: 'all' });
		clean.showMore();
		expect(clean.pages()).toEqual([]);
		data.value = { rows: [row('email/a.jpg')], total: { count: 2, bytes: 1 }, matching: 2, next: 'cur_2' };
		clean.showMore();
		expect(clean.pages()).toEqual(['cur_2']);
		expect(data.email?.()).toEqual({ sent: 'all', after: 'cur_2' });
		data.value = {
			rows: [row('email/a.jpg'), row('email/b.jpg')],
			total: { count: 2, bytes: 1 },
			matching: 2,
			next: null,
		};
		expect(clean.rows().map((one) => one.key)).toEqual(['email/a.jpg', 'email/b.jpg']);
		clean.toggle('email/a.jpg');
		clean.toggle('email/zz.jpg');
		expect(clean.chosen().map((one) => one.key)).toEqual(['email/a.jpg']);
		expect(clean.chosenSent()).toBeNull();
		expect(clean.chosenCost()).toBeGreaterThanOrEqual(0);
		clean.toggle('email/a.jpg');
		clean.clear();
		expect(clean.picked().size).toBe(0);
		data.value = undefined;
		clean.shown.set([]);
		expect(clean.rows()).toEqual([]);
	});

	it('deletes nothing before the question is drawn or with nothing chosen, and says when the delete failed', async () => {
		const drawless = setup([row('email/a.jpg')], 'yes', '');
		drawless.clean.toggle('email/a.jpg');
		await drawless.clean.deleteChosen();
		expect(drawless.modals.open).not.toHaveBeenCalled();
		const { clean, gateway, toastr, modals } = setup([row('email/a.jpg')]);
		await clean.deleteChosen();
		expect(modals.open).not.toHaveBeenCalled();
		clean.toggle('email/a.jpg');
		gateway.deleteEmailPictures.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await clean.deleteChosen();
		expect(toastr.error).toHaveBeenCalledWith('fm_action_failed');
		expect(clean.deleting()).toBe(false);
	});
});
