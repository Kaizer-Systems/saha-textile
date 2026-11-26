import { TestBed } from '@angular/core/testing';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { from, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';

import { FmDetails, TEXT_BAR_AFTER_MS } from './fm-details';

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

const setup = (details: unknown, fails = false, confirm = true, save: () => unknown = () => of(undefined)) => {
	const gateway = {
		details: vi.fn(() => (fails ? throwError(() => new Error('down')) : of(details))),
		itemActivity: vi.fn(() => of({ items: [{ action: 'media.upload', createdAt: '2026-11-16T00:00:00.000Z' }] })),
		removeVersion: vi.fn(() => of(undefined)),
		saveText: vi.fn(save),
	};
	const notifications = { success: vi.fn(), error: vi.fn() };
	const modal = { dismiss: vi.fn(), close: vi.fn() };
	const modals = {
		open: vi.fn(() => ({ result: confirm ? Promise.resolve('yes') : Promise.reject(new Error('dismissed')) })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MediaLibraryGateway, useValue: gateway },
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: NgbModal, useValue: modals },
			{ provide: ToastrService, useValue: notifications },
			{ provide: MediaUploads, useValue: { followRename: vi.fn(async () => true) } },
			{ provide: ActiveLanguages, useValue: { list: () => ['en', 'bn'], isDraft: () => false } },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string) =>
						key === 'fm_activity_upload'
							? 'Uploaded'
							: key.startsWith('profile_name_product')
								? 'Product 3:4'
								: key,
				},
			},
		],
	});
	TestBed.overrideComponent(FmDetails, {
		set: { imports: [], template: '<ng-template #fmRemoveVersion></ng-template>' },
	});
	const fixture = TestBed.createComponent(FmDetails);
	fixture.detectChanges();
	const popup = fixture.componentInstance;
	return { popup, gateway, notifications, modal, modals };
};

describe('FmDetails', () => {
	it('loads the photo, opens only the first version, and lists its Activity', async () => {
		const { popup } = setup(file());
		await popup.start('med_1');
		expect(popup.isImage()).toBe(true);
		expect([...popup.open()]).toEqual(['product_3x4.white']);
		expect(popup.preview()).toBe('https://cdn/x/card-400.webp');
		const [white, crop] = popup.details()?.versions ?? [];
		expect(popup.versionName(white as never)).toBe('Product 3:4 · profile_fill_white');
		expect(popup.versionName(crop as never)).toBe('hero_21x9 · profile_fill_crop');
		expect(popup.sizeCount(white as never)).toBe(2);
		expect(popup.widths((white as never as { families: never[] }).families[0] as never)).toBe('200, 400');
		expect(popup.activityText(popup.activity()[0] as never)).toBe('Uploaded');
		expect(popup.activityText({ action: 'media.something_new' })).toBe('media.something_new');
	});

	it('opens and closes each level with its arrow', async () => {
		const { popup } = setup(file());
		await popup.start('med_1');
		popup.toggle('product_3x4.white|card');
		popup.toggle('product_3x4.white');
		expect([...popup.open()]).toEqual(['product_3x4.white|card']);
	});

	it('a file other than a photo shows its Activity; a failure says so', async () => {
		const plain = setup(file('file'));
		await plain.popup.start('med_1');
		expect(plain.popup.tab()).toBe('activity');
		expect(plain.popup.preview()).toBeNull();
		const broken = setup(null, true);
		await broken.popup.start('med_1');
		expect(broken.popup.error()).toBe(true);
	});

	it('copies a file’s address', async () => {
		const { popup, notifications } = setup(file());
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		await popup.copy('https://cdn/x/card-200.webp');
		expect(writeText).toHaveBeenCalledWith('https://cdn/x/card-200.webp');
		expect(notifications.success).toHaveBeenCalledWith('fm_address_copied');
	});

	it('opens the version the website shows first, and says which versions are in use (A31, step 3a)', async () => {
		const shown = file();
		const [white, crop] = shown.versions;
		const used = {
			...shown,
			usedOn: ['product · Red Banarasi Silk'],
			versions: [
				{ ...white, shown: false },
				{ ...crop, state: 'ready', shown: true },
			],
		};
		const { popup } = setup(used);
		await popup.start('med_1');
		expect([...popup.open()]).toEqual(['hero_21x9.crop']);
		const [first, second] = popup.details()?.versions ?? [];
		expect(popup.inUse(second as never)).toBe(true);
		expect(popup.canRemove(second as never)).toBe(false);
		expect(popup.inUse(first as never)).toBe(false);
		expect(popup.canRemove(first as never)).toBe(true);
	});

	it('its buttons hand Add versions, Download original and Share back to the Media page', async () => {
		const { popup, modal } = setup(file());
		await popup.start('med_1');
		popup.act('add_versions');
		expect(modal.close).toHaveBeenCalledWith({
			kind: 'add_versions',
			versions: [
				{ id: 'product_3x4.white', state: 'ready' },
				{ id: 'hero_21x9.crop', state: 'making' },
			],
		});
		popup.act('share');
		expect(modal.close).toHaveBeenLastCalledWith({ kind: 'share' });
	});

	it('removes an unused version after a yes, then shows the photo again; no means nothing happens', async () => {
		const { popup, gateway, notifications } = setup(file());
		await popup.start('med_1');
		const [white] = popup.details()?.versions ?? [];
		await popup.remove(white as never);
		expect(gateway.removeVersion).toHaveBeenCalledWith('med_1', 'product_3x4.white');
		expect(notifications.success).toHaveBeenCalledWith('fm_version_removed');
		expect(gateway.details).toHaveBeenCalledTimes(2);
		const no = setup(file(), false, false);
		await no.popup.start('med_1');
		await no.popup.remove(white as never);
		expect(no.gateway.removeVersion).not.toHaveBeenCalled();
	});

	it('A42: the Text tab holds the photo’s default alt text and caption per language; an empty alt is a to-do', async () => {
		const { popup } = setup(file());
		await popup.start('med_1', 'text');
		expect(popup.tab()).toBe('text');
		expect(popup.alt()).toEqual({ en: 'Red Banarasi silk saree, front', fr: 'Sari rouge' });
		expect(popup.textGaps()).toEqual({ en: [], bn: [{ key: 'fm_text_alt', label: 'fm_text_alt' }] });
		popup.locale.set('bn');
		popup.setText('alt', 'লাল বেনারসি সিল্ক শাড়ি');
		popup.setText('caption', '  ');
		expect(popup.textGaps()['bn']).toEqual([]);
		// A file other than a photo has no Text tab: it opens on Activity whatever was asked.
		const other = setup(file('file'));
		await other.popup.start('med_1', 'text');
		expect(other.popup.tab()).toBe('activity');
	});

	it('saves trimmed text, keeps a language the form doesn’t show, and leaves out empty ones', async () => {
		const { popup, gateway, notifications } = setup(file());
		await popup.start('med_1');
		popup.locale.set('bn');
		popup.setText('alt', '  লাল বেনারসি  ');
		popup.setText('caption', '   ');
		await popup.saveText();
		expect(gateway.saveText).toHaveBeenCalledWith('med_1', {
			alt: { en: 'Red Banarasi silk saree, front', fr: 'Sari rouge', bn: 'লাল বেনারসি' },
			caption: {},
		});
		expect(notifications.success).toHaveBeenCalledWith('fm_text_saved');
		expect(popup.saving()).toBe(false);
	});

	it('A49: the bar shows only after 0.3 s, the fields wait, and a refusal is said in a toast', async () => {
		vi.useFakeTimers();
		try {
			let finish: (value: unknown) => void = () => undefined;
			const { popup, notifications } = setup(file(), false, true, () =>
				from(new Promise((resolve) => (finish = resolve))),
			);
			await popup.start('med_1');
			const saving = popup.saveText();
			expect(popup.saving()).toBe(true);
			vi.advanceTimersByTime(TEXT_BAR_AFTER_MS - 1);
			expect(popup.savingSlow()).toBe(false);
			vi.advanceTimersByTime(1);
			expect(popup.savingSlow()).toBe(true);
			// A second click while saving sends nothing.
			await popup.saveText();
			finish(undefined);
			await saving;
			expect(popup.savingSlow()).toBe(false);
			expect(notifications.success).toHaveBeenCalledTimes(1);

			const refused = setup(file(), false, true, () => throwError(() => new Error('down')));
			await refused.popup.start('med_1');
			await refused.popup.saveText();
			expect(refused.notifications.error).toHaveBeenCalledWith('fm_action_failed');
		} finally {
			vi.useRealTimers();
		}
	});
});
