import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';

import { FmPhone } from './fm-phone';
import { FmUploadFlow } from './fm-upload-flow';
import { FmUploadPopups } from './fm-upload-popups';

vi.mock('@data-access/queries/media-library.queries', async (original) => ({
	...(await original<object>()),
	injectMediaStorageQuery: () => ({ data: () => undefined }),
}));

const TEMPLATES = ['fmUploadReview', 'fmDuplicate', 'fmOnDemand', 'fmStorageRefused', 'fmOverLimit', 'fmNotes'];

const profile = (key: string, extra: Record<string, unknown> = {}) => ({
	key,
	name: key,
	builtIn: true,
	shape: { width: 3, height: 4 },
	roles: ['card'],
	fills: ['white', 'blur'],
	...extra,
});

function make(template: string) {
	const flow = {
		review: signal<{ place: string } | null>(null),
		profiles: signal([
			profile('product_3x4'),
			profile('own', { builtIn: false, name: 'Lookbook', shape: null }),
			profile('icon', { roles: ['brand_icon'], shape: { width: 1, height: 1 }, fills: ['white'] }),
		]),
		start: vi.fn(async () => undefined),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: FmUploadFlow, useValue: flow },
			{ provide: FmPhone, useValue: { is: signal(false) } },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: Record<string, unknown>) =>
						params ? `${key}(${Object.values(params).join(',')})` : key,
				},
			},
		],
	});
	TestBed.overrideComponent(FmUploadPopups, { set: { imports: [], template } });
	const fixture = TestBed.createComponent(FmUploadPopups);
	fixture.detectChanges();
	return { popups: fixture.componentInstance, flow };
}

const templates = (names: string[]) => names.map((name) => `<ng-template #${name}></ng-template>`).join('');

describe('the upload popups host', () => {
	it('names where files go, and starts only once every popup is drawn', () => {
		const none = make('');
		expect(none.popups.uploadPlace()).toBe('fm_my_files');
		expect(none.popups.popups()).toBeNull();
		none.popups.startUpload(() => undefined);
		expect(none.flow.start).not.toHaveBeenCalled();
		const { popups, flow } = make(templates(TEMPLATES));
		flow.review.set({ place: 'Wedding' });
		expect(popups.uploadPlace()).toBe('Wedding');
		expect(Object.keys(popups.popups() ?? {})).not.toContain('anyway');
		popups.startUpload(() => undefined);
		expect(flow.start).toHaveBeenCalledTimes(1);
		const all = make(templates([...TEMPLATES, 'fmUploadAnyway', 'fmReplaceInUse']));
		expect(Object.keys(all.popups.popups() ?? {})).toEqual(expect.arrayContaining(['anyway', 'replaceInUse']));
	});

	it('words rows, profiles, picks, fill choices, notes and shapes', () => {
		const { popups } = make('');
		expect(popups.rowKind({ name: 'a.jpg', waits: true } as never).icon).toBe('ri-image-line');
		expect(popups.rowKind({ name: 'a.pdf', waits: false } as never).icon).toBe('ri-file-pdf-2-line');
		expect(popups.profileName('gone')).toBe('gone');
		expect(popups.profileName('own')).toBe('Lookbook');
		expect(popups.profileName('product_3x4')).toBe('profile_name_product_3x4');
		expect(popups.pickLabels({ profileKey: 'product_3x4', fills: ['as_is', 'white'] } as never)).toEqual([
			'profile_name_product_3x4',
			'profile_name_product_3x4 · profile_fill_white',
		]);
		expect(popups.pickLabels({ profileKey: 'gone', fills: ['blur'] } as never)).toEqual([
			'gone · profile_fill_blur',
		]);
		const row = (size: unknown) => ({ size }) as never;
		expect(popups.fillChoices(row(null), 'product_3x4')).toEqual([]);
		expect(popups.fillChoices(row({ width: 3, height: 4 }), 'gone')).toEqual([]);
		expect(popups.fillChoices(row({ width: 3, height: 4 }), 'own')).toEqual([]);
		expect(popups.fillChoices(row({ width: 300, height: 400 }), 'product_3x4')).toEqual([]);
		expect(
			popups.fillChoices(row({ width: 400, height: 400 }), 'product_3x4').map((choice) => choice.fill),
		).toEqual(['white', 'blur']);
		expect(popups.fillChoices(row({ width: 400, height: 300 }), 'icon')[0]?.label).toBe(
			'profile_fill_white_background',
		);
		expect(popups.noteText({ profileKey: 'own', kind: 'small', px: 1200, has: 800 } as never)).toBe(
			'fm_note_small(Lookbook,1200,800)',
		);
		expect(popups.shapeOf(row({ width: 3000, height: 4000 }))).toBe('3:4');
		expect(popups.shapeOf(row(null))).toBe('');
	});
});
