import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { PageBuilderGateway, type PageSection } from '@core/page-builder/page-builder.gateway';

import { HEARTBEAT_MS, PbBuilder, SAVE_DELAY_MS } from './pb-builder';

const t = (key: string, params?: Record<string, unknown>) => {
	if (key === 'pb_section_boom') throw new Error('no words');
	return params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;
};

const section = (id: string, type = 'product_row', over: Record<string, unknown> = {}) =>
	({ id, type, hidden: false, ...over }) as unknown as PageSection;

function view(over: Record<string, unknown> = {}) {
	return {
		layout: { id: 'lay_1', name: 'Diwali home' },
		draft: { id: 'rev_1', number: 3, sections: [section('s1'), section('s2', 'newsletter')] },
		problems: [{ kind: 'words' }],
		allowedSections: ['product_row', 'newsletter'],
		...over,
	};
}

interface Options {
	platform?: string;
	locales?: string[];
	params?: Record<string, string>;
	start?: unknown;
	granted?: boolean;
}

function setup(options: Options = {}) {
	const gateway = {
		layout: vi.fn(() =>
			options.start instanceof Error ? throwError(() => options.start) : of(options.start ?? view()),
		),
		lock: vi.fn(() =>
			of(
				options.granted === false
					? { granted: false, lock: { holderName: 'Bina Das', since: '2026-11-24T00:00:00.000Z' } }
					: { granted: true },
			),
		),
		saveDraft: vi.fn((_id: string, body: { sections: PageSection[] }) =>
			of(view({ draft: { id: 'rev_2', number: 4, sections: body.sections } })),
		),
		unlock: vi.fn(() => of(undefined)),
		createBlock: vi.fn(() => of({})),
		bringBack: vi.fn(() => of(view({ draft: { id: 'rev_9', number: 9, sections: [section('s9')] } }))),
		goLiveView: vi.fn(() => of({ problems: [] })),
	};
	const onTap = new Subject<void>();
	const toastr = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(() => ({ onTap })) };
	const router = { navigate: vi.fn() };
	const instance = { start: vi.fn() };
	const modals = {
		open: vi.fn(() => {
			const result = Promise.resolve(modals.answer);
			return { componentInstance: instance, result };
		}),
		answer: null as unknown,
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: PageBuilderGateway, useValue: gateway },
			{ provide: ToastrService, useValue: toastr },
			{ provide: TranslocoService, useValue: { translate: t } },
			{ provide: NgbModal, useValue: modals },
			{ provide: Router, useValue: router },
			{ provide: ActiveLanguages, useValue: { list: () => options.locales ?? ['en', 'bn'] } },
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			{
				provide: ActivatedRoute,
				useValue: {
					snapshot: { paramMap: convertToParamMap(options.params ?? { type: 'HOME', id: 'lay_1' }) },
				},
			},
		],
	});
	TestBed.overrideComponent(PbBuilder, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(PbBuilder);
	return { fixture, c: fixture.componentInstance, gateway, toastr, router, modals, instance, onTap };
}

const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};
const key = (k: string, over: Partial<KeyboardEventInit> = {}) => new KeyboardEvent('keydown', { key: k, ...over });

beforeEach(() => {
	vi.useFakeTimers();
	sessionStorage.clear();
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	sessionStorage.clear();
});

describe('the page builder: opening a layout (B1, E4, FX-23)', () => {
	it('loads the draft, picks the first section, takes the lock and keeps it with a heartbeat', async () => {
		const { c, gateway } = setup();
		await settle();
		expect(c.pageType).toBe('home');
		expect(c.layoutId).toBe('lay_1');
		expect(c.sections().map((row) => row.id)).toEqual(['s1', 's2']);
		expect(c.selectedId()).toBe('s1');
		expect(c.selected()?.id).toBe('s1');
		expect(c.problemCount()).toBe(1);
		expect(c.outline()).toEqual([
			{ type: 'product_row', arrangement: null },
			{ type: 'newsletter', arrangement: null },
		]);
		await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
		expect(gateway.lock).toHaveBeenCalledTimes(2);
	});

	it('reads the defaults for a page with no type, id, draft or language', async () => {
		const { c } = setup({ params: {}, locales: [], start: view({ draft: null, problems: [] }) });
		await settle();
		expect(c.pageType).toBe('home');
		expect(c.layoutId).toBe('');
		expect(c.locale()).toBe('en');
		expect(c.sections()).toEqual([]);
		expect(c.selectedId()).toBeNull();
		expect(c.selected()).toBeNull();
		expect(c.problemCount()).toBe(0);
		const none = setup({ start: view({ draft: null }) });
		none.c.view.set(null);
		expect(none.c.problemCount()).toBe(0);
	});

	it('brings back changes kept in the tab for the same draft, and ignores others', async () => {
		sessionStorage.setItem('pb_unsaved_lay_1', JSON.stringify({ draftId: 'rev_1', sections: [section('kept')] }));
		const kept = setup();
		await settle();
		expect(kept.c.sections().map((row) => row.id)).toEqual(['kept']);
		expect(kept.c.saveState()).toBe('retrying');
		await vi.advanceTimersByTimeAsync(0);
		expect(kept.gateway.saveDraft).toHaveBeenCalled();
		sessionStorage.setItem(
			'pb_unsaved_lay_1',
			JSON.stringify({ draftId: 'rev_other', sections: [section('kept')] }),
		);
		const other = setup();
		await settle();
		expect(other.c.sections().map((row) => row.id)).toEqual(['s1', 's2']);
		sessionStorage.setItem('pb_unsaved_lay_1', '{broken');
		const broken = setup();
		await settle();
		expect(broken.c.sections()).toHaveLength(2);
		sessionStorage.setItem('pb_unsaved_lay_1', JSON.stringify({ draftId: null, sections: [section('kept')] }));
		const noDraft = setup({ start: view({ draft: null }) });
		await settle();
		expect(noDraft.c.sections().map((row) => row.id)).toEqual(['kept']);
	});

	it('only looks on the server: nothing kept, no heartbeat, no saving', async () => {
		sessionStorage.setItem('pb_unsaved_lay_1', JSON.stringify({ draftId: 'rev_1', sections: [section('kept')] }));
		const { c, gateway, fixture } = setup({ platform: 'server' });
		await settle();
		expect(c.sections().map((row) => row.id)).toEqual(['s1', 's2']);
		c.change([section('x')]);
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + HEARTBEAT_MS);
		expect(gateway.saveDraft).not.toHaveBeenCalled();
		expect(gateway.lock).toHaveBeenCalledTimes(1);
		fixture.destroy();
		expect(gateway.unlock).not.toHaveBeenCalled();
	});

	it('says when the layout cannot open, and goes read-only while someone else edits', async () => {
		const failed = setup({ start: new Error('down') });
		await settle();
		expect(failed.toastr.error).toHaveBeenCalledWith('pb_action_failed');
		const locked = setup({ granted: false });
		await settle();
		expect(locked.c.readOnly()).toBe(true);
		expect(locked.c.blocker()).toEqual({ name: 'Bina Das', at: '2026-11-24T00:00:00.000Z' });
		locked.c.change([section('x')]);
		expect(locked.c.sections()).toHaveLength(2);
		locked.gateway.lock.mockReturnValue(of({ granted: true }) as never);
		await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
		expect(locked.c.saveState()).toBe('saved');
		locked.gateway.lock.mockReturnValue(throwError(() => new Error('down')) as never);
		await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
		expect(locked.c.saveState()).toBe('saved');
		locked.gateway.lock.mockReturnValue(of({ granted: true }) as never);
		await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
		expect(locked.c.blocker()).toBeNull();
	});
});

describe('the page builder: changing sections (B2–B5)', () => {
	it('adds a section of a type or from a saved block, after the chosen one', async () => {
		const { c, modals, instance } = setup();
		c.view.set(null);
		await c.addSection();
		expect(modals.open).not.toHaveBeenCalled();
		await settle();
		await c.addSection();
		expect(instance.start).toHaveBeenCalledWith(['product_row', 'newsletter']);
		expect(c.sections()).toHaveLength(2);
		modals.answer = { kind: 'type', type: 'newsletter' };
		await c.addSection();
		expect(c.sections()).toHaveLength(3);
		expect(c.sections()[1]?.type).toBe('newsletter');
		expect(c.pane()).toBe('settings');
		modals.answer = { kind: 'block', block: { id: 'blk_1', section: section('src', 'product_row') }, linked: true };
		await c.addSection();
		expect(c.sections().find((row) => (row as { block?: { id: string } }).block?.id === 'blk_1')).toBeTruthy();
		expect(c.canUndo()).toBe(true);
	});

	it('moves, duplicates, hides and removes sections, each one an undo step', async () => {
		const { c, onTap } = setup();
		await settle();
		c.move(0, 1);
		expect(c.sections().map((row) => row.id)).toEqual(['s2', 's1']);
		c.move(9, 0);
		c.drop({ previousIndex: 0, currentIndex: 0 } as never);
		c.drop({ previousIndex: 1, currentIndex: 0 } as never);
		expect(c.sections().map((row) => row.id)).toEqual(['s1', 's2']);
		c.duplicate('s1');
		expect(c.sections()).toHaveLength(3);
		c.duplicate('nope');
		c.toggleHidden(c.sections()[0] as PageSection);
		expect(c.sections()[0]?.hidden).toBe(true);
		expect(c.outline()).toHaveLength(2);
		c.toggleHidden(c.sections()[0] as PageSection);
		c.selectedId.set('s2');
		c.remove('s2');
		expect(c.selectedId()).toBe('s1');
		c.remove('nope');
		c.remove('s1');
		onTap.next();
		expect(c.sections().some((row) => row.id === 's1')).toBe(true);
		c.updateSection(section('s1', 'boom'));
		expect(c.sections().find((row) => row.id === 's1')?.type).not.toBe('boom');
	});

	it('undoes and redoes, keeps a chosen section that still exists, and names each step', async () => {
		const { c } = setup();
		await settle();
		c.undo();
		c.redo();
		c.selectedId.set('s2');
		c.remove('s2');
		c.selectedId.set('gone');
		c.undo();
		expect(c.selectedId()).toBe('s1');
		c.selectedId.set('s2');
		c.redo();
		expect(c.selectedId()).toBe('s1');
		c.undo();
		c.choose('s2');
		c.undo();
		expect(c.pane()).toBe('settings');
		c.change([section('a')]);
		c.change([section('a')]);
		c.move(0, 1);
		const lines = c.sessionLines();
		expect(lines.at(-2)?.steps).toBe(2);
		expect(lines.at(-1)?.steps).toBe(1);
		for (let i = 0; i < 52; i++) c.change([section(`n${i}`)]);
		expect(c.sessionLines().reduce((sum, line) => sum + line.steps, 0)).toBe(50);
	});

	it('saves a section as a block, and says when it cannot', async () => {
		const { c, gateway, toastr } = setup();
		await c.saveAsBlock(section('s1'));
		expect(toastr.success).toHaveBeenCalledWith('pb_block_saved');
		gateway.createBlock.mockReturnValueOnce(
			throwError(() => ({ error: { code: 'x', message: 'Too many blocks' } })),
		);
		await c.saveAsBlock(section('s1'));
		expect(toastr.error).toHaveBeenCalledWith('Too many blocks');
		gateway.createBlock.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.saveAsBlock(section('s1'));
		expect(toastr.error).toHaveBeenCalledWith('pb_action_failed');
	});
});

describe('the page builder: keyboard (E3, SG-8)', () => {
	it('undoes with ⌘/Ctrl+Z and redoes with Shift, except while typing', async () => {
		const { c } = setup();
		await settle();
		c.move(0, 1);
		c.onKey(key('z'));
		c.onKey(key('x', { ctrlKey: true }));
		const input = document.createElement('input');
		document.body.append(input);
		const typed = key('z', { ctrlKey: true });
		Object.defineProperty(typed, 'target', { value: input });
		c.onKey(typed);
		expect(c.sections()[0]?.id).toBe('s2');
		c.onKey(key('Z', { metaKey: true }));
		expect(c.sections()[0]?.id).toBe('s1');
		c.onKey(key('z', { ctrlKey: true, shiftKey: true }));
		expect(c.sections()[0]?.id).toBe('s2');
		input.remove();
	});

	it('picks a row up with Space, moves it with the arrows, drops it or puts it back', async () => {
		const { c } = setup();
		await settle();
		const [first, second] = c.sections() as [PageSection, PageSection];
		c.outlineKey(key('ArrowDown'), first, 0);
		c.outlineKey(key(' '), first, 0);
		expect(c.lifted()).toEqual({ id: 's1', from: 0 });
		expect(c.announcement()).toBe('pb_kb_lifted(pb_section_product_row|1|2)');
		c.outlineKey(key('ArrowDown'), second, 1);
		c.outlineKey(key('ArrowUp'), first, 0);
		c.outlineKey(key('Enter'), first, 0);
		c.outlineKey(key('ArrowDown'), first, 0);
		expect(c.sections().map((row) => row.id)).toEqual(['s2', 's1']);
		c.outlineKey(key('ArrowDown'), first, 1);
		await vi.advanceTimersByTimeAsync(1);
		c.outlineKey(key('Escape'), first, 1);
		expect(c.sections().map((row) => row.id)).toEqual(['s1', 's2']);
		expect(c.lifted()).toBeNull();
		c.outlineKey(key(' '), first, 0);
		c.outlineKey(key(' '), first, 0);
		expect(c.canUndo()).toBe(false);
		c.outlineKey(key(' '), first, 0);
		c.outlineKey(key('ArrowDown'), first, 0);
		c.outlineKey(key(' '), first, 1);
		expect(c.canUndo()).toBe(true);
		expect(c.announcement()).toContain('pb_kb_dropped');
		c.outlineKey(key(' '), second, 0);
		c.outlineKey(key('ArrowDown'), second, 0);
		c.sections.set(c.sections().filter((row) => row.id !== 's2'));
		c.outlineBlur();
		c.outlineBlur();
		expect(c.lifted()).toBeNull();
	});

	it('ignores the keyboard while read-only', async () => {
		const { c } = setup({ granted: false });
		await settle();
		c.outlineKey(key(' '), c.sections()[0] as PageSection, 0);
		expect(c.lifted()).toBeNull();
	});
});

describe('the page builder: saving (FX-23)', () => {
	it('saves once after typing stops, and again when changed meanwhile', async () => {
		const { c, gateway } = setup();
		await settle();
		c.change([section('a')]);
		c.change([section('b')]);
		expect(c.saveState()).toBe('saving');
		expect(sessionStorage.getItem('pb_unsaved_lay_1')).toContain('"b"');
		gateway.saveDraft.mockImplementationOnce((_id, body) => {
			c.change([section('c')]);
			return of(view({ draft: { id: 'rev_2', number: 4, sections: body.sections } }));
		});
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(gateway.saveDraft).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(gateway.saveDraft).toHaveBeenCalledTimes(2);
		expect(c.saveState()).toBe('saved');
		expect(sessionStorage.getItem('pb_unsaved_lay_1')).toBeNull();
		gateway.saveDraft.mockReturnValueOnce(of(view({ draft: null })) as never);
		c.change([section('d')]);
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(c.saveState()).toBe('saved');
	});

	it('stops on a conflict, a refused value or a lock, and retries anything else with growing waits', async () => {
		const { c, gateway, toastr } = setup();
		await settle();
		gateway.saveDraft.mockReturnValueOnce(
			throwError(() => ({ status: 409, error: { error: { savedBy: 'Bina Das', savedAt: '2026-11-24' } } })),
		);
		c.change([section('a')]);
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(c.saveState()).toBe('conflict');
		expect(c.blocker()).toEqual({ name: 'Bina Das', at: '2026-11-24' });
		c.change([section('b')]);
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(gateway.saveDraft).toHaveBeenCalledTimes(1);
		c.reload();
		await settle();
		expect(c.saveState()).toBe('saved');
		gateway.saveDraft.mockReturnValueOnce(throwError(() => ({ status: 409 })));
		c.change([section('c')]);
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(c.blocker()).toEqual({ name: null, at: null });
		c.reload();
		await settle();
		gateway.saveDraft.mockReturnValueOnce(throwError(() => ({ status: 400 })));
		c.change([section('d')]);
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(c.saveState()).toBe('refused');
		expect(toastr.error).toHaveBeenCalledWith('pb_value_refused');
		gateway.saveDraft.mockReturnValueOnce(
			throwError(() => ({ status: 400, error: { error: { code: 'x', message: 'Too long' } } })),
		);
		c.change([section('e')]);
		expect(c.saveState()).toBe('saving');
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(toastr.error).toHaveBeenCalledWith('Too long');
		gateway.saveDraft.mockReturnValueOnce(
			throwError(() => ({ status: 423, error: { error: { holderName: 'Ravi', since: 'now' } } })),
		);
		c.change([section('f')]);
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(c.saveState()).toBe('locked');
		expect(c.blocker()).toEqual({ name: 'Ravi', at: 'now' });
		c.saveState.set('saved');
		gateway.saveDraft.mockReturnValueOnce(throwError(() => ({ status: 423 })));
		c.change([section('g')]);
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(c.blocker()).toEqual({ name: null, at: null });
		c.saveState.set('saved');
		gateway.saveDraft.mockReturnValue(throwError(() => ({ status: 500 })) as never);
		c.change([section('h')]);
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(c.saveState()).toBe('retrying');
		for (const wait of [2_000, 5_000, 10_000, 30_000, 30_000]) await vi.advanceTimersByTimeAsync(wait);
		const tries = gateway.saveDraft.mock.calls.length;
		c.change([section('i')]);
		expect(c.saveState()).toBe('retrying');
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(gateway.saveDraft.mock.calls.length).toBeGreaterThan(tries);
	});

	it('still saves when the tab refuses to keep the changes', async () => {
		const { c, gateway } = setup();
		await settle();
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('private window');
		});
		vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
			throw new Error('private window');
		});
		c.change([section('a')]);
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(gateway.saveDraft).toHaveBeenCalled();
		expect(c.saveState()).toBe('saved');
	});

	it('saves what is pending and lets go of the lock on closing; a locked view keeps it', async () => {
		const { c, gateway, fixture } = setup();
		await settle();
		c.change([section('a')]);
		fixture.destroy();
		expect(gateway.saveDraft).toHaveBeenCalled();
		expect(gateway.unlock).toHaveBeenCalledWith('lay_1');
		const quiet = setup();
		await settle();
		quiet.gateway.unlock.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		quiet.fixture.destroy();
		const locked = setup({ granted: false });
		await settle();
		locked.fixture.destroy();
		expect(locked.gateway.unlock).not.toHaveBeenCalled();
	});
});

describe('the page builder: History and Go Live (E1–E5)', () => {
	it('opens History with this session, and brings a saved version back', async () => {
		const { c, gateway, modals, instance, toastr } = setup();
		await settle();
		await c.openHistory();
		expect(instance.start).toHaveBeenCalledWith(
			expect.objectContaining({ layoutId: 'lay_1', name: 'Diwali home', readOnly: false }),
		);
		c.view.set(null);
		await c.openHistory();
		expect(instance.start).toHaveBeenLastCalledWith(expect.objectContaining({ name: '' }));
		modals.answer = { bringBack: 'rev_5' };
		c.change([section('pending')]);
		await c.openHistory();
		expect(gateway.saveDraft).toHaveBeenCalled();
		expect(gateway.bringBack).toHaveBeenCalledWith('lay_1', { revisionId: 'rev_5', expectedDraftId: 'rev_2' });
		expect(c.sections().map((row) => row.id)).toEqual(['s9']);
		expect(c.selectedId()).toBe('s9');
		expect(toastr.success).toHaveBeenCalledWith('pb_brought_back');
		gateway.bringBack.mockReturnValueOnce(of(view({ draft: null })) as never);
		await c.openHistory();
		expect(c.sections()).toEqual([]);
		c.sections.set([section('s9')]);
		c.selectedId.set('s9');
		gateway.bringBack.mockReturnValueOnce(
			of(view({ draft: { id: 'r', number: 1, sections: [section('s9')] } })) as never,
		);
		await c.openHistory();
		expect(c.selectedId()).toBe('s9');
		gateway.bringBack.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await c.openHistory();
		expect(toastr.error).toHaveBeenCalledWith('pb_action_failed');
		modals.answer = null;
		await c.openHistory();
	});

	it('saves first, then opens Go Live, and follows each outcome', async () => {
		const { c, gateway, modals, router, toastr } = setup();
		await settle();
		c.change([section('pending')]);
		await c.openGoLive();
		expect(gateway.saveDraft).toHaveBeenCalled();
		expect(gateway.goLiveView).toHaveBeenCalledWith('lay_1');
		modals.answer = { kind: 'went', state: 'live' };
		await c.openGoLive();
		expect(toastr.success).toHaveBeenCalledWith('pb_went_live');
		expect(router.navigate).toHaveBeenCalledWith(['/page-builder', 'home']);
		modals.answer = { kind: 'reviewed' };
		await c.openGoLive();
		expect(toastr.success).toHaveBeenCalledWith('pb_review_asked');
		modals.answer = { kind: 'go_to', problem: { kind: 'page_settings' } };
		await c.openGoLive();
		expect(router.navigate).toHaveBeenCalledWith(['/page-builder', 'home', 'settings']);
		modals.answer = { kind: 'go_to', problem: { kind: 'words', locale: 'bn', sectionId: 'pending' } };
		await c.openGoLive();
		expect(c.locale()).toBe('bn');
		expect(c.selectedId()).toBe('pending');
		modals.answer = { kind: 'go_to', problem: { kind: 'words', locale: 'fr', sectionId: null } };
		await c.openGoLive();
		expect(c.locale()).toBe('bn');
		modals.answer = { kind: 'go_to', problem: { kind: 'pictures', locale: null, sectionId: null } };
		await c.openGoLive();
		modals.answer = { kind: 'moved_on' };
		await c.openGoLive();
		expect(c.saveState()).toBe('conflict');
		await c.openGoLive();
		expect(toastr.warning).toHaveBeenCalledWith('pb_save_first');
	});

	it('opens Go Live read-only, retries a pending save first, and says when it cannot open', async () => {
		const locked = setup({ granted: false });
		await settle();
		await locked.c.openGoLive();
		expect(locked.gateway.goLiveView).toHaveBeenCalled();
		const { c, gateway, toastr } = setup();
		await settle();
		c.saveState.set('saving');
		await c.openGoLive();
		expect(gateway.saveDraft).toHaveBeenCalledTimes(1);
		c.saveState.set('retrying');
		gateway.goLiveView.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await c.openGoLive();
		expect(toastr.error).toHaveBeenCalledWith('pb_action_failed');
	});
});
