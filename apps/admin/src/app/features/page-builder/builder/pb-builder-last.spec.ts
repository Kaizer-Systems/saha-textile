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

import { PbBuilder } from './pb-builder';

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

beforeEach(() => {
	vi.useFakeTimers();
	sessionStorage.clear();
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	sessionStorage.clear();
});

/** Every popup this test opens is closed without an answer. */
const closedPopups = (modals: { open: ReturnType<typeof vi.fn> }, instance: unknown) =>
	modals.open.mockImplementation(() => {
		const result = Promise.reject(new Error('closed'));
		return { componentInstance: instance, result };
	});

describe('the page builder: the last cases', () => {
	it('draws a banner in its arrangement in the outline', async () => {
		const banner = section('b1', 'banner_arrangement', { arrangement: 'hero_main_side' });
		const { c } = setup({ start: view({ draft: { id: 'rev_1', number: 1, sections: [banner] } }) });
		await settle();
		expect(c.outline()).toEqual([{ type: 'banner_arrangement', arrangement: 'hero_main_side' }]);
	});

	it('closing Add section, History or Go Live without an answer changes nothing', async () => {
		const { c, modals, instance, gateway, router } = setup();
		await settle();
		closedPopups(modals, instance);
		await c.addSection();
		expect(c.sections()).toHaveLength(2);
		await c.openHistory();
		expect(gateway.bringBack).not.toHaveBeenCalled();
		await c.openGoLive();
		expect(gateway.goLiveView).toHaveBeenCalled();
		expect(router.navigate).not.toHaveBeenCalled();
	});

	it('removing the last section leaves none chosen, and undoing back to an empty layout chooses none', async () => {
		const one = setup({ start: view({ draft: { id: 'rev_1', number: 1, sections: [section('s1')] } }) });
		await settle();
		one.c.remove('s1');
		expect(one.c.sections()).toEqual([]);
		expect(one.c.selectedId()).toBeNull();

		const empty = setup({ start: view({ draft: { id: 'rev_1', number: 1, sections: [] } }) });
		await settle();
		empty.modals.answer = { kind: 'type', type: 'newsletter' };
		await empty.c.addSection();
		expect(empty.c.selectedId()).not.toBeNull();
		empty.c.undo();
		expect(empty.c.sections()).toEqual([]);
		expect(empty.c.selectedId()).toBeNull();
	});

	it('moves no focus while drawn on the server', () => {
		const { c } = setup({ platform: 'server' });
		const timers = vi.getTimerCount();
		(c as unknown as { focusRow(id: string): void }).focusRow('s1');
		expect(vi.getTimerCount()).toBe(timers);
	});
});
