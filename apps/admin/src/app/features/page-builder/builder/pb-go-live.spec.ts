import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { type GoLiveView, PageBuilderGateway } from '@core/page-builder/page-builder.gateway';

import { PbGoLive } from './pb-go-live';

const view = (overrides: Partial<GoLiveView> = {}): GoLiveView => ({
	layoutId: 'lay_winter',
	layoutName: 'Winter weddings',
	draftRevisionId: 'rev_5',
	problems: [],
	waitingPictures: 0,
	liveLayoutName: 'Today’s home page',
	changes: {
		firstTime: false,
		list: [
			{ kind: 'added', sectionId: 'hero', type: 'banner_arrangement' },
			{ kind: 'moved', sectionId: 'new', type: 'product_row' },
			{ kind: 'moved', sectionId: 'sale', type: 'product_row' },
		],
		newPictures: 3,
	},
	budget: [{ key: 'early_pictures', value: 1, limit: 1 }],
	summary: { sections: 9, sliders: 1, sliderPictures: 3, earlyPictures: 1 },
	notes: [],
	linkedBlocks: [],
	handBackTo: [{ layoutId: 'lay_today', name: 'Today’s home page' }],
	naturalHandBack: 'lay_today',
	canGoLive: true,
	...overrides,
});

const setup = (goLive: () => unknown = () => of({ state: 'live', page: {} })) => {
	TestBed.resetTestingModule();
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	const gateway = {
		goLive: vi.fn(goLive),
		goLiveView: vi.fn(() => of(view({ problems: [{ kind: 'link_gone', sectionId: 'hero', href: '/x' }] }))),
		askReview: vi.fn(() => of(undefined)),
	};
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: PageBuilderGateway, useValue: gateway },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: Record<string, unknown>) =>
						params && 'count' in params ? `${key}:${String(params['count'])}` : key,
					getActiveLang: () => 'en',
					getTranslation: () => ({}),
				},
			},
		],
	});
	TestBed.overrideComponent(PbGoLive, { set: { imports: [], template: '' } });
	const popup = TestBed.createComponent(PbGoLive).componentInstance;
	return { popup, modal, gateway };
};

describe('Go Live popup (E1, E2, E5, P6)', () => {
	it('says what will change in one line, and lists each language with what it still lacks', () => {
		const { popup } = setup();
		popup.start(
			'lay_winter',
			view({
				problems: [
					{ kind: 'words', sectionId: 'hero', piece: 'main', picture: 1, locale: 'bn', field: 'ctaLabel' },
					{ kind: 'page_settings', locale: 'bn', field: 'title' },
				],
			}),
			['en', 'bn'],
			{ hero: 'Three pieces' },
		);
		expect(popup.changesLine()).toBe(
			'pb_changes_added_other:1, pb_changes_moved_other:2, pb_changes_pictures_other:3',
		);
		expect(popup.languageLines().map((line) => [line.locale, line.todo.length])).toEqual([
			['en', 0],
			['bn', 2],
		]);
		expect(popup.where(popup.languageLines()[1]?.todo[0] ?? { kind: '' })).toBe(
			'Three pieces · pb_piece_main · pb_picture_n',
		);
		expect(popup.canGo()).toBe(false);
		expect(popup.handBackTo()).toBe('lay_today');
	});

	it('goes live now, or schedules with an end and a hand-back, in India time', async () => {
		const { popup, gateway, modal } = setup();
		popup.start('lay_winter', view(), ['en', 'bn'], {});
		expect(popup.canGo()).toBe(true);
		popup.when.set('at');
		expect(popup.canGo()).toBe(false);
		popup.fromLocal.set('2099-12-01T00:00');
		popup.ends.set('at');
		popup.untilLocal.set('2099-11-30T00:00');
		expect(popup.canGo()).toBe(false);
		popup.untilLocal.set('2100-02-15T23:59');
		expect(popup.canGo()).toBe(true);
		await popup.go();
		expect(gateway.goLive).toHaveBeenCalledWith('lay_winter', {
			expectedDraftId: 'rev_5',
			from: '2099-11-30T18:30:00.000Z',
			until: '2100-02-15T18:29:00.000Z',
			handBackTo: 'lay_today',
			whenReady: false,
		});
		expect(modal.close).toHaveBeenCalledWith(expect.objectContaining({ kind: 'went', state: 'live' }));
	});

	it('asks first when pictures are still being made, then goes live by itself when ready (E5)', async () => {
		const { popup, gateway } = setup();
		popup.start('lay_winter', view({ waitingPictures: 1 }), ['en'], {});
		await popup.go();
		expect(popup.asking()).toBe(true);
		expect(gateway.goLive).not.toHaveBeenCalled();
		await popup.go(true);
		expect(gateway.goLive).toHaveBeenCalledWith('lay_winter', expect.objectContaining({ whenReady: true }));
	});

	it('shows the checks again when something changed meanwhile, and hands a newer draft back to the builder', async () => {
		const refused = setup(() =>
			throwError(() => ({ status: 400, error: { error: { message: 'Go Live waits' } } })),
		);
		refused.popup.start('lay_winter', view(), ['en'], {});
		await refused.popup.go();
		expect(refused.gateway.goLiveView).toHaveBeenCalled();
		expect(refused.popup.linkProblems()).toHaveLength(1);
		const moved = setup(() => throwError(() => ({ status: 409 })));
		moved.popup.start('lay_winter', view(), ['en'], {});
		await moved.popup.go();
		expect(moved.modal.close).toHaveBeenCalledWith({ kind: 'moved_on' });
	});

	it('lets admins who may not go live ask for review instead (SG-18)', async () => {
		const { popup, gateway, modal } = setup();
		popup.start('lay_winter', view({ canGoLive: false }), ['en'], {});
		expect(popup.canGo()).toBe(false);
		popup.note.set('  Ready for Monday ');
		await popup.askReview();
		expect(gateway.askReview).toHaveBeenCalledWith('lay_winter', 'Ready for Monday');
		expect(modal.close).toHaveBeenCalledWith({ kind: 'reviewed' });
	});
});

describe('words over pictures in Go Live (SG-1)', () => {
	it('names each unreadable line with its screens, how well it reads, and the fixes that pass', () => {
		const { popup } = setup();
		popup.start(
			'lay_winter',
			view({
				problems: [
					{
						kind: 'words_unreadable',
						sectionId: 'hero',
						piece: 'main',
						picture: 2,
						band: 'phone',
						field: 'heading',
						ratio: 2.85,
						needed: 4.5,
						fixes: [{ ink: 'brand_dark', backing: 'none', ratio: 5.4 }],
					},
				],
			}),
			['en'],
			{ hero: 'Three pieces' },
		);
		expect(popup.wordProblems()).toHaveLength(1);
		expect(popup.wordsLine(popup.wordProblems()[0] as never)).toBe('pb_words_line pb_words_fixes');
		expect(popup.canGo()).toBe(false);
	});
});
