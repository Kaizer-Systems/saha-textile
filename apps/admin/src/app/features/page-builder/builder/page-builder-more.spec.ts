import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';
import { type GoLiveView, type PageSection, PageBuilderGateway } from '@core/page-builder/page-builder.gateway';

import { moveSection } from './builder-state';
import { PbAddSection } from './pb-add-section';
import { PbGoLive } from './pb-go-live';
import { PbHistory } from './pb-history';
import { PbPreview } from './pb-preview';
import { outlineMessage } from './preview-messages';

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

const goLiveView = (over: Partial<GoLiveView> = {}): GoLiveView =>
	({
		layoutId: 'lay_1',
		layoutName: 'Winter',
		draftRevisionId: 'rev_5',
		problems: [],
		waitingPictures: 0,
		liveLayoutName: 'Today',
		changes: { firstTime: false, list: [], newPictures: 0 },
		budget: [],
		summary: { sections: 1, sliders: 0, sliderPictures: 0, earlyPictures: 0 },
		notes: [],
		linkedBlocks: [],
		handBackTo: [{ layoutId: 'lay_today', name: 'Today' }],
		naturalHandBack: null,
		canGoLive: true,
		...over,
	}) as GoLiveView;

function goLive() {
	const modal = { close: vi.fn() };
	const gateway = {
		goLive: vi.fn(() => of({ state: 'scheduled', page: { type: 'home' } })),
		goLiveView: vi.fn(() => of(goLiveView({ layoutName: 'Fresh' }))),
		askReview: vi.fn(() => of(undefined)),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: PageBuilderGateway, useValue: gateway },
			{
				provide: TranslocoService,
				useValue: { translate: t, getActiveLang: () => 'en', getTranslation: () => ({}) },
			},
		],
	});
	TestBed.overrideComponent(PbGoLive, { set: { imports: [], template: '' } });
	return { c: TestBed.createComponent(PbGoLive).componentInstance, modal, gateway };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('Go Live: what it lists (E1, E2, SG-1, SG-16)', () => {
	it('reads nothing before it starts, and picks the hand-back', () => {
		const { c } = goLive();
		expect(c.problems()).toEqual([]);
		expect(c.changesLine()).toBe('');
		expect(c.canGo()).toBe(false);
		expect(c.handBackName()).toBeNull();
		c.start('lay_1', goLiveView({ handBackTo: [] }), ['en'], {});
		expect(c.handBackTo()).toBeNull();
		c.start('lay_1', goLiveView(), ['en'], {});
		expect(c.handBackTo()).toBe('lay_today');
		expect(c.handBackName()).toBe('Today');
		c.handBackTo.set('lay_gone');
		expect(c.handBackName()).toBeNull();
	});

	it('sorts the problems into their lists', () => {
		const { c } = goLive();
		const kinds = [
			'words',
			'page_settings',
			'phone_picture',
			'link_gone',
			'words_unreadable',
			'budget',
			'empty',
			'not_allowed',
			'duplicate_id',
			'picture_missing',
		];
		c.start(
			'lay_1',
			goLiveView({ problems: kinds.map((kind) => ({ kind, locale: 'bn' })) as never }),
			['en', 'bn'],
			{},
		);
		expect(c.languageLines().map((line) => line.todo.length)).toEqual([0, 2]);
		expect(c.phoneProblems()).toHaveLength(1);
		expect(c.linkProblems()).toHaveLength(1);
		expect(c.wordProblems()).toHaveLength(1);
		expect(c.budgetProblems()).toHaveLength(1);
		expect(c.layoutProblems()).toHaveLength(3);
		expect(c.pictureProblems().length).toBeGreaterThanOrEqual(0);
	});

	it('checks the times: a start, and an end after it', () => {
		const { c } = goLive();
		c.start('lay_1', goLiveView(), ['en'], {});
		expect(c.timesReady()).toBe(true);
		c.when.set('at');
		expect(c.timesReady()).toBe(false);
		c.fromLocal.set('2030-01-01T10:00');
		expect(c.timesReady()).toBe(true);
		c.ends.set('at');
		expect(c.timesReady()).toBe(false);
		c.untilLocal.set('2029-01-01T10:00');
		expect(c.timesReady()).toBe(false);
		c.untilLocal.set('2030-02-01T10:00');
		expect(c.timesReady()).toBe(true);
		c.when.set('now');
		expect(c.timesReady()).toBe(true);
		expect(c.canGo()).toBe(true);
	});

	it('says what changes in one line', () => {
		const { c } = goLive();
		c.start('lay_1', goLiveView({ changes: { firstTime: true, list: [], newPictures: 0 } } as never), ['en'], {});
		expect(c.changesLine()).toBe('pb_changes_first');
		c.start('lay_1', goLiveView(), ['en'], {});
		expect(c.changesLine()).toBe('pb_changes_none');
		c.start(
			'lay_1',
			goLiveView({
				changes: {
					firstTime: false,
					list: [{ kind: 'removed' }, { kind: 'shown' }, { kind: 'shown' }],
					newPictures: 2,
				},
			} as never),
			['en'],
			{},
		);
		expect(c.changesLine().split(', ')).toHaveLength(3);
	});

	it('words budgets, fields, sections, places and unreadable lines', () => {
		const { c } = goLive();
		c.start('lay_1', goLiveView(), ['en'], { hero: 'Main banner' });
		expect(c.budgetText({ key: 'script_kb', value: 3, limit: null } as never)).toBe('pb_budget_later(3)');
		expect(c.budgetText({ key: 'early_pictures', value: 1, limit: 1 } as never)).toBe('pb_budget_of_count(1|1)');
		expect(c.budgetText({ key: 'page_kb', value: 3.9, limit: 10 } as never)).toBe(
			'pb_budget_of(3.9|10|pb_unit_page_kb)',
		);
		expect(c.fieldName('title')).toBe('pb_field_title');
		expect(c.fieldName('heading')).toBe('banner_heading');
		expect(c.fieldName(undefined)).toBe('banner_');
		expect(c.sectionName('hero')).toBe('Main banner');
		expect(c.sectionName('row', 'product_row')).toBe('pb_section_product_row');
		expect(c.sectionName('row')).toBe('row');
		expect(c.sectionName(undefined)).toBe('');
		expect(c.where({ kind: 'x', sectionId: 'hero', piece: 'main', picture: 0 } as never)).toBe(
			'Main banner · pb_piece_main · pb_picture_n(1)',
		);
		expect(c.where({ kind: 'x' } as never)).toBe('');
		const line = (fixes?: unknown) =>
			c.wordsLine({
				kind: 'words_unreadable',
				sectionId: 'hero',
				field: 'heading',
				ratio: 2.1,
				needed: 4.5,
				fixes,
			} as never);
		expect(line()).toContain('pb_words_no_fix');
		expect(line()).toContain('pb_band_desktop');
		expect(line([{ ink: 'white', backing: 'none', ratio: 5 }])).toContain('pb_fix_item_plain(pb_ink_white|5)');
		expect(line([{ ink: 'dark', backing: 'soft', ratio: 7 }])).toContain(
			'pb_fix_item(pb_ink_dark|pb_backing_soft|7)',
		);
		expect(c.wordsLine({ kind: 'words_unreadable', band: 'phone', fixes: [] } as never)).toContain('pb_band_phone');
	});
});

describe('Go Live: going (E2, E5, SG-18)', () => {
	it('goes nowhere without a draft or with something in the way', async () => {
		const { c, gateway } = goLive();
		await c.go();
		c.start('lay_1', goLiveView({ draftRevisionId: null } as never), ['en'], {});
		await c.go();
		c.start('lay_1', goLiveView({ canGoLive: false }), ['en'], {});
		await c.go();
		expect(gateway.goLive).not.toHaveBeenCalled();
	});

	it('asks first while pictures are being made, then goes when ready, handing back at the end', async () => {
		const { c, gateway, modal } = goLive();
		c.start('lay_1', goLiveView({ waitingPictures: 2 }), ['en'], {});
		await c.go();
		expect(c.asking()).toBe(true);
		c.ends.set('at');
		c.untilLocal.set('2099-01-01T10:00');
		await c.go(true);
		expect(gateway.goLive).toHaveBeenCalledWith(
			'lay_1',
			expect.objectContaining({ handBackTo: 'lay_today', whenReady: true }),
		);
		expect(modal.close).toHaveBeenCalledWith({ kind: 'went', state: 'scheduled', page: { type: 'home' } });
		expect(c.asking()).toBe(false);
	});

	it('hands a newer draft back, shows the checks again after a refusal, and says why', async () => {
		const { c, gateway, modal } = goLive();
		c.start('lay_1', goLiveView(), ['en'], {});
		gateway.goLive.mockReturnValueOnce(throwError(() => ({ status: 409 })) as never);
		await c.go();
		expect(modal.close).toHaveBeenCalledWith({ kind: 'moved_on' });
		gateway.goLive.mockReturnValueOnce(
			throwError(() => ({ status: 400, error: { code: 'x', message: 'A link went' } })) as never,
		);
		await c.go();
		expect(c.view()?.layoutName).toBe('Fresh');
		expect(c.error()).toBe('A link went');
		gateway.goLive.mockReturnValueOnce(throwError(() => ({ status: 400 })) as never);
		gateway.goLiveView.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await c.go();
		expect(c.view()?.layoutName).toBe('Fresh');
		expect(c.error()).toBe('pb_action_failed');
		gateway.goLive.mockReturnValueOnce(throwError(() => ({ status: 500 })) as never);
		await c.go();
		expect(c.busy()).toBe(false);
	});

	it('asks for review, and goes to a problem', async () => {
		const { c, gateway, modal } = goLive();
		c.start('lay_1', goLiveView(), ['en'], {});
		c.note.set('  please look  ');
		await c.askReview();
		expect(gateway.askReview).toHaveBeenCalledWith('lay_1', 'please look');
		expect(modal.close).toHaveBeenCalledWith({ kind: 'reviewed' });
		gateway.askReview.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await c.askReview();
		expect(c.error()).toBe('pb_action_failed');
		c.goTo({ kind: 'words' } as never);
		expect(modal.close).toHaveBeenLastCalledWith({ kind: 'go_to', problem: { kind: 'words' } });
	});
});

describe('History, Add a section and the preview (E3, B2, step 6)', () => {
	it('lists the saved versions, opens one in a tab, and brings one back', async () => {
		const modal = { close: vi.fn() };
		const gateway = {
			history: vi.fn(() => of({ revisions: [{ id: 'rev_1' }] })),
			previewCode: vi.fn(() => of({ code: 'c 1' })),
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbActiveModal, useValue: modal },
				{ provide: PageBuilderGateway, useValue: gateway },
				{ provide: TranslocoService, useValue: { translate: t } },
			],
		});
		TestBed.overrideComponent(PbHistory, { set: { imports: [], template: '' } });
		const c = TestBed.createComponent(PbHistory).componentInstance;
		const start = {
			layoutId: 'lay_1',
			pageType: 'home',
			locale: 'bn',
			name: 'Winter',
			session: [],
			readOnly: false,
		};
		c.start(start);
		expect(c.revisions()).toEqual([{ id: 'rev_1' }]);
		gateway.history.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		c.start(start);
		expect(c.error()).toBe('pb_action_failed');
		const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
		vi.spyOn(window, 'open').mockReturnValueOnce(tab as never);
		await c.look({ id: 'rev_1' } as never);
		expect(tab.opener).toBeNull();
		expect(tab.location.href).toBe(`${runtimeConfig.siteUrl.replace(/\/$/, '')}/bn/__preview/home?code=c%201`);
		vi.spyOn(window, 'open').mockReturnValueOnce(null);
		await c.look({ id: 'rev_1' } as never);
		gateway.previewCode.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		vi.spyOn(window, 'open').mockReturnValueOnce(tab as never);
		await c.look({ id: 'rev_1' } as never);
		expect(tab.close).toHaveBeenCalled();
		gateway.previewCode.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		vi.spyOn(window, 'open').mockReturnValueOnce(null);
		await c.look({ id: 'rev_1' } as never);
		c.bringBack({ id: 'rev_1' } as never);
		expect(modal.close).toHaveBeenCalledWith({ bringBack: 'rev_1' });
	});

	it('offers the allowed types and the saved blocks of those types', () => {
		const modal = { close: vi.fn() };
		const gateway = {
			blocks: vi.fn(() =>
				of([
					{ block: { id: 'b1', section: { type: 'newsletter' } } },
					{ block: { id: 'b2', section: { type: 'blog_posts' } } },
				]),
			),
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbActiveModal, useValue: modal },
				{ provide: PageBuilderGateway, useValue: gateway },
			],
		});
		TestBed.overrideComponent(PbAddSection, { set: { imports: [], template: '' } });
		const c = TestBed.createComponent(PbAddSection).componentInstance;
		c.start(['newsletter', 'banner_arrangement'] as never);
		expect(c.blocks().map((row) => row.block.id)).toEqual(['b1']);
		gateway.blocks.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		c.start(['newsletter'] as never);
		expect(c.blocks()).toEqual([]);
		expect(c.outline('banner_arrangement' as never)).toEqual([
			{ type: 'banner_arrangement', arrangement: 'hero_full' },
		]);
		expect(c.outline('newsletter' as never)).toEqual([{ type: 'newsletter', arrangement: null }]);
		c.pickType('newsletter' as never);
		expect(modal.close).toHaveBeenCalledWith({ kind: 'type', type: 'newsletter' });
		c.linked.set(true);
		c.pickBlock({ block: { id: 'b1' } } as never);
		expect(modal.close).toHaveBeenLastCalledWith({ kind: 'block', block: { id: 'b1' }, linked: true });
	});

	function preview(platform = 'browser') {
		const gateway = { previewCode: vi.fn(() => of({ code: 'c1' })) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: PageBuilderGateway, useValue: gateway },
				{ provide: DomSanitizer, useValue: { bypassSecurityTrustResourceUrl: (url: string) => url } },
				{ provide: PLATFORM_ID, useValue: platform },
			],
		});
		TestBed.overrideComponent(PbPreview, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(PbPreview);
		fixture.componentRef.setInput('layoutId', 'lay_1');
		fixture.componentRef.setInput('pageType', 'home');
		fixture.componentRef.setInput('locale', 'en');
		return { fixture, c: fixture.componentInstance };
	}

	it('fits the frame to the pane as it resizes, and listens to the shop only in a browser', async () => {
		let report: (entries: Array<{ contentRect: { width: number } } | undefined>) => void = () => undefined;
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(callback: typeof report) {
					report = callback;
				}
				observe(): void {}
			},
		);
		const { c, fixture } = preview();
		await Promise.resolve();
		report([{ contentRect: { width: 600 } }]);
		expect(c.paneWidth()).toBe(600);
		report([{ contentRect: { width: 0 } }]);
		report([undefined]);
		expect(c.paneWidth()).toBe(600);
		fixture.destroy();
		vi.unstubAllGlobals();
		const server = preview('server');
		expect(server.c.paneWidth()).toBe(800);
	});

	it('outlines the chosen section and hears the shop’s messages', () => {
		const { c, fixture } = preview();
		const posted: unknown[] = [];
		const frameWindow = { postMessage: (message: unknown) => posted.push(message) };
		const frame = { contentWindow: frameWindow };
		Object.defineProperty(c, 'frame', { value: () => ({ nativeElement: frame }) });
		const chosen: string[] = [];
		c.choose.subscribe((id) => chosen.push(id));
		const origin = c.shopOrigin();
		const hear = (data: unknown, source: unknown = frameWindow, from = origin) =>
			c.heard({ data, source, origin: from } as unknown as MessageEvent);
		const ready = { source: 'st-preview', type: 'ready' };
		hear(ready, null);
		hear(ready, frameWindow, 'https://elsewhere.test');
		expect(posted).toEqual([]);
		fixture.componentRef.setInput('chosen', 's1');
		fixture.detectChanges();
		expect(posted.at(-1)).toEqual(outlineMessage('s1'));
		posted.length = 0;
		hear(ready);
		expect(posted).toEqual([outlineMessage('s1')]);
		hear({ source: 'st-preview', type: 'select', sectionId: 's2' });
		expect(chosen).toEqual(['s2']);
		hear(outlineMessage('s3'));
		expect(chosen).toEqual(['s2']);
		Object.defineProperty(c, 'frame', { value: () => undefined });
		hear(ready);
		expect(posted).toHaveLength(1);
	});

	it('keeps the order when a move is out of range', () => {
		const rows = [{ id: 'a' }, { id: 'b' }] as unknown as PageSection[];
		expect(moveSection(rows, 0, 5)).toEqual(rows);
		expect(moveSection(rows, 1, 0).map((row) => row.id)).toEqual(['b', 'a']);
	});
});
