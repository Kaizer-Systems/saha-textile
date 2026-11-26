import { TestBed } from '@angular/core/testing';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';

import { FmDetails } from './fm-details';

/** Image or file details (media step 2e; A31, A31B, A32, A43). */
const file = (kind: 'image' | 'file' = 'image') => ({
	id: 'med_1',
	name: 'red-banarasi.jpg',
	kind,
	contentType: 'image/jpeg',
	bytes: 6_000_000,
	width: 3000,
	height: 4000,
	folderPath: ['Banarasi'],
	uploadedBy: 'Moulik',
	uploadedAt: '2026-11-16T00:00:00.000Z',
	usedOn: [],
	visibility: 'public',
	versions:
		kind === 'image'
			? [
					{
						id: 'product_3x4.white',
						profileKey: 'product_3x4',
						fill: 'white',
						state: 'ready',
						error: null,
						createdAt: '2026-11-16T00:00:00.000Z',
						bytes: 600,
						families: [
							{
								role: 'card',
								files: [
									{
										width: 200,
										height: 267,
										bytes: 200,
										format: 'image/webp',
										url: 'https://cdn/x/card-200.webp',
									},
									{
										width: 400,
										height: 533,
										bytes: 400,
										format: 'image/webp',
										url: 'https://cdn/x/card-400.webp',
									},
								],
							},
						],
					},
					{
						id: 'hero_21x9.crop',
						profileKey: 'hero_21x9',
						fill: 'crop',
						state: 'making',
						error: null,
						createdAt: '2026-11-16T00:00:00.000Z',
						bytes: 0,
						families: [],
					},
				]
			: [],
	perPhoto: [],
	text: { alt: { en: 'Red Banarasi silk saree, front', fr: 'Sari rouge' }, caption: {} },
});

interface Options {
	answer?: unknown;
	template?: string;
	locales?: string[];
}

const refused = { error: { issues: [{ code: 'x', message: 'Refused here' }] } };

function setup(details: unknown, options: Options = {}) {
	const gateway = {
		details: vi.fn(() => of(details)),
		itemActivity: vi.fn(() => of({ items: [] })),
		removeVersion: vi.fn(() => of(undefined)),
		saveWebName: vi.fn(() => of(undefined)),
	};
	const toastr = { success: vi.fn(), error: vi.fn() };
	const uploads = { followRename: vi.fn(async () => true) };
	const answer = 'answer' in options ? options.answer : 'yes';
	const modals = {
		open: vi.fn(() => ({ result: answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer) })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MediaLibraryGateway, useValue: gateway },
			{ provide: NgbActiveModal, useValue: { dismiss: vi.fn(), close: vi.fn() } },
			{ provide: NgbModal, useValue: modals },
			{ provide: ToastrService, useValue: toastr },
			{ provide: MediaUploads, useValue: uploads },
			{
				provide: ActiveLanguages,
				useValue: { list: () => options.locales ?? ['en', 'bn'], isDraft: () => false },
			},
			{
				provide: TranslocoService,
				useValue: { translate: (key: string) => (key === 'profile_family_card' ? 'Cards' : key) },
			},
		],
	});
	TestBed.overrideComponent(FmDetails, {
		set: {
			imports: [],
			template:
				options.template ??
				'<ng-template #fmRemoveVersion></ng-template><ng-template #fmWebName></ng-template>',
		},
	});
	const fixture = TestBed.createComponent(FmDetails);
	fixture.detectChanges();
	return { popup: fixture.componentInstance, gateway, toastr, uploads, modals };
}

describe('FmDetails: the last cases', () => {
	it('reads nothing before it starts: English without languages, no uses, no versions', () => {
		const { popup } = setup(file(), { locales: [] });
		expect(popup.locale()).toBe('en');
		expect(popup.inUse({ shown: true } as never)).toBe(false);
		expect(popup.canRemove({ shown: false, state: 'ready' } as never)).toBe(false);
		popup.act('add_versions');
		popup.webName.set('red-banarasi');
		expect(popup.webNameValid()).toBe(true);
		popup.webName.set('Red Banarasi');
		expect(popup.webNameValid()).toBe(false);
	});

	it('previews the smallest file of 300 px or more, and keeps a photo with no text', async () => {
		const photo = file();
		const ready = photo.versions[0] as { families: Array<{ files: Array<{ width: number; url: string }> }> };
		ready.families[0]!.files.push({ width: 800, url: 'https://cdn/x/card-800.webp' } as never);
		const { popup } = setup({ ...photo, text: undefined });
		await popup.start('med_1');
		expect(popup.preview()).toBe('https://cdn/x/card-400.webp');
		expect([popup.alt(), popup.caption()]).toEqual([{}, {}]);
	});

	it('changes the web name only to a new one, follows the remake, and says why a change failed', async () => {
		const withSlug = { ...file(), slug: 'red-banarasi' };
		const noSlug = setup(file());
		await noSlug.popup.start('med_1');
		await noSlug.popup.changeWebName();
		expect(noSlug.modals.open).not.toHaveBeenCalled();
		const drawless = setup(withSlug, { template: '' });
		await drawless.popup.start('med_1');
		await drawless.popup.changeWebName();
		expect(drawless.modals.open).not.toHaveBeenCalled();
		const closed = setup(withSlug, { answer: new Error('closed') });
		await closed.popup.start('med_1');
		await closed.popup.changeWebName();
		const same = setup(withSlug, { answer: 'red-banarasi' });
		await same.popup.start('med_1');
		await same.popup.changeWebName();
		expect([closed.gateway.saveWebName, same.gateway.saveWebName].map((call) => call.mock.calls.length)).toEqual([
			0, 0,
		]);
		const { popup, gateway, toastr, uploads } = setup(withSlug, { answer: 'red-silk' });
		await popup.start('med_1');
		await popup.changeWebName();
		expect(gateway.saveWebName).toHaveBeenCalledWith('med_1', 'red-silk');
		expect(uploads.followRename).toHaveBeenCalledWith('med_1', 'red-banarasi.jpg');
		expect(toastr.success).toHaveBeenCalledWith('fm_web_name_saved');
		gateway.saveWebName.mockReturnValueOnce(throwError(() => refused) as never);
		await popup.changeWebName();
		expect(toastr.error).toHaveBeenLastCalledWith('Refused here');
		gateway.saveWebName.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await popup.changeWebName();
		expect(toastr.error).toHaveBeenLastCalledWith('fm_action_failed');
	});

	it('removes nothing before the question is drawn, and says why a removal failed', async () => {
		const drawless = setup(file(), { template: '' });
		await drawless.popup.start('med_1');
		await drawless.popup.remove(file().versions[0] as never);
		expect(drawless.modals.open).not.toHaveBeenCalled();
		const { popup, gateway, toastr } = setup(file());
		await popup.remove(file().versions[0] as never);
		expect(gateway.removeVersion).not.toHaveBeenCalled();
		await popup.start('med_1');
		gateway.removeVersion.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await popup.remove(file().versions[0] as never);
		expect(toastr.error).toHaveBeenCalledWith('fm_action_failed');
	});

	it('names an odd fill as it is, a size family in words or by its role, a file by its name, and says when copying failed', async () => {
		const { popup, toastr } = setup(file());
		expect(popup.versionName({ profileKey: 'own', fill: 'weird' } as never)).toBe('own · weird');
		expect(popup.familyName({ role: 'card', files: [] } as never)).toBe('Cards');
		expect(popup.familyName({ role: 'zoom', files: [] } as never)).toBe('zoom');
		expect(popup.fileLabel('https://cdn/x/card-200.webp')).toBe('card-200.webp');
		const writeText = vi.fn(async () => Promise.reject(new Error('denied')));
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		await popup.copy('https://cdn/x');
		expect(toastr.error).toHaveBeenCalledWith('fm_action_failed');
	});
});
