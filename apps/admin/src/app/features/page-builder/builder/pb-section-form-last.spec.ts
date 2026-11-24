import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';

import { newSection, pictureFor } from './builder-state';
import { PbSectionForm } from './pb-section-form';

import type { PageSection } from '@core/page-builder/page-builder.gateway';

interface Piece {
	name: string;
	pictures: unknown[];
	slider: { seconds: number; controls: string; after: string };
}

function form(section: PageSection, options: { readOnly?: boolean; answer?: unknown } = {}) {
	const instance = { start: vi.fn() };
	const modals = {
		open: vi.fn(() => {
			const result =
				options.answer instanceof Error ? Promise.reject(options.answer) : Promise.resolve(options.answer);
			result.catch(() => undefined);
			return { componentInstance: instance, result };
		}),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: modals },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			{ provide: ActiveLanguages, useValue: { list: () => ['en', 'bn'] } },
		],
	});
	TestBed.overrideComponent(PbSectionForm, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(PbSectionForm);
	fixture.componentRef.setInput('section', section);
	fixture.componentRef.setInput('locale', 'bn');
	fixture.componentRef.setInput('readOnly', options.readOnly ?? false);
	const c = fixture.componentInstance;
	const out: PageSection[] = [];
	c.changed.subscribe((next) => out.push(next));
	const last = () => out.at(-1) as unknown as Record<string, unknown>;
	return { c, fixture, out, last, modals, instance };
}

const banner = (pictures = 0) => {
	const section = newSection('banner_arrangement', []) as unknown as { pieces: Piece[] };
	(section.pieces[0] as Piece).pictures = Array.from({ length: pictures }, (_, i) => pictureFor(`med_${i}`, null));
	return section as unknown as PageSection;
};

describe('a section’s pictures: the last cases', () => {
	it('a picture editor closed without saving changes nothing', async () => {
		const { c, out } = form(banner(1), { answer: new Error('closed') });
		await c.editPicture(0, 0);
		expect(out).toEqual([]);
	});
});
