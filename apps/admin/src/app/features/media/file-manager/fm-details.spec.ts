import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';
import { NotificationService } from '@data-access/services/notification.service';

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
});

const setup = (details: unknown, fails = false) => {
	const gateway = {
		details: vi.fn(() => (fails ? throwError(() => new Error('down')) : of(details))),
		itemActivity: vi.fn(() => of({ items: [{ action: 'media.upload', createdAt: '2026-11-16T00:00:00.000Z' }] })),
	};
	const notifications = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MediaLibraryGateway, useValue: gateway },
			{ provide: NgbActiveModal, useValue: { dismiss: vi.fn() } },
			{ provide: NotificationService, useValue: notifications },
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
	TestBed.overrideComponent(FmDetails, { set: { imports: [], template: '' } });
	const popup = TestBed.createComponent(FmDetails).componentInstance;
	return { popup, gateway, notifications };
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
		expect(notifications.showSuccess).toHaveBeenCalledWith('fm_address_copied');
	});
});
