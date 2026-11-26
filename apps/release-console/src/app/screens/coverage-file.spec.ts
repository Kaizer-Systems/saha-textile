import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { describe, expect, it, vi } from 'vitest';

import { CoverageFile, type CoverageJump } from './coverage-file';
import { ConsoleContext } from '../data/console-context';

import type { CoverageFileAnswer, VendorAnswer } from '@saha-textile/release-console-contracts';

const file = (over: Partial<CoverageFileAnswer> = {}): VendorAnswer<CoverageFileAnswer> => ({
	state: 'ok',
	readAt: '2026-11-24T03:00:00.000Z',
	data: {
		path: 'apps/admin/src/pick.ts',
		sha: 'abcdef12',
		counts: [3, 5, 1, 2, 1, 1, 3, 4],
		text: ['export function pick(a) {', "\tif (a) return 'x';", '\treturn null;', '}'],
		lines: [
			{ h: null, c: 'none', notes: [] },
			{
				h: 4,
				c: 'part',
				notes: [
					{ kind: 'branch', say: 'never false', code: 'a' },
					{ kind: 'statement', say: 'never ran: part of this line', code: null },
				],
			},
			{ h: 0, c: 'miss', notes: [] },
			{ h: 4, c: 'run', notes: [] },
		],
		gaps: [
			{ kind: 'part', from: 2, to: 2, say: 'never false', code: 'a' },
			{ kind: 'miss', from: 3, to: 3, say: 'never ran', code: 'return null;' },
			{ kind: 'function', from: 4, to: 4, say: 'never called', code: 'f()' },
		],
		specs: [
			{
				file: 'apps/admin/src/pick.spec.ts',
				tests: [
					{ name: 'pick > keeps', state: 'passed', ms: 3 },
					{ name: 'pick > sizes', state: 'failed', ms: 4 },
					{ name: 'pick > later', state: 'skipped', ms: 0 },
				],
			},
		],
		failures: [
			{
				file: 'apps/admin/src/pick.spec.ts',
				name: 'pick > sizes',
				error: {
					name: 'AssertionError',
					message: "expected 50 to be '50'",
					expected: '"50"',
					actual: '50',
					frames: [{ file: 'apps/admin/src/pick.ts', line: 2, column: 1 }],
				},
			},
			{
				file: 'apps/admin/src/other.spec.ts',
				name: 'other',
				error: { name: 'Error', message: 'boom', frames: [] },
			},
		],
		changed: [2],
		note: 'This copy had uncommitted changes when it was measured.',
		...over,
	},
});

function render(inputs: Record<string, unknown>) {
	TestBed.configureTestingModule({
		providers: [provideRouter([]), { provide: ConsoleContext, useValue: { projectId: () => 'p' } }],
	});
	const fixture = TestBed.createComponent(CoverageFile);
	for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
	fixture.detectChanges();
	const jumps: CoverageJump[] = [];
	fixture.componentInstance.goTo.subscribe((j) => jumps.push(j));
	const el = fixture.nativeElement as HTMLElement;
	return { fixture, el, c: fixture.componentInstance, jumps };
}

describe('the file at the side', () => {
	it('shows the four numbers, the gaps, the failures, the note and every line with its colour and words', () => {
		const { el } = render({ answer: file(), repository: 'Kaizer-Systems/saha-textile' });
		expect([...el.querySelectorAll('.rc-row .rc-pill')].map((p) => p.textContent?.trim())).toEqual([
			'S 60.0%',
			'B 50.0%',
			'F 100%',
			'L 75.0%',
			'3 gaps',
			'2 failed',
			'1 changed lines',
		]);
		expect(el.textContent).toContain('uncommitted changes');
		const rows = [...el.querySelectorAll('.rc-cov-code .l')];
		expect(rows.map((r) => [...r.classList].sort().join(' '))).toEqual(['l none', 'l part', 'err l', 'l run']);
		expect(rows[1]?.querySelector('.src')?.textContent).toBe('4×');
		expect([...(rows[1]?.querySelectorAll('.rc-pill') ?? [])].map((p) => p.textContent?.trim())).toEqual([
			'never false: a',
			'never ran: part of this line',
			'changed',
		]);
		expect(rows[2]?.querySelector('.rc-pill')).toBeNull();
		expect(el.querySelector('.hljs-keyword')).not.toBeNull();
		expect(el.querySelectorAll('.rc-cov-gaps i').length).toBe(2);
		expect(el.querySelector('.rc-cov-gaps i.red')).not.toBeNull();
		expect(el.querySelector<HTMLAnchorElement>('a.rc-btn')?.href).toBe(
			'https://github.com/Kaizer-Systems/saha-textile/blob/abcdef12/apps/admin/src/pick.ts',
		);
	});

	it('steps round the gaps, jumps to a pressed spot on the gap strip, and closes', () => {
		const { el, c, jumps, fixture } = render({ answer: file() });
		c.step(1);
		c.step(1);
		c.step(-1);
		c.step(-1);
		c.step(-1);
		expect(jumps.map((j) => j.line)).toEqual([2, 3, 2, 4, 3]);
		const strip = el.querySelector<HTMLButtonElement>('.rc-cov-gaps') as HTMLButtonElement;
		strip.getBoundingClientRect = () => ({ top: 100, height: 400 }) as DOMRect;
		strip.dispatchEvent(new MouseEvent('click', { clientY: 400, bubbles: true }));
		expect(jumps.at(-1)).toEqual({ path: 'apps/admin/src/pick.ts', line: 3, tab: 'lines' });
		strip.getBoundingClientRect = () => ({ top: 0, height: 0 }) as DOMRect;
		strip.dispatchEvent(new MouseEvent('click', { clientY: 10, bubbles: true }));
		expect(jumps).toHaveLength(6);
		const closed = vi.fn();
		c.closed.subscribe(closed);
		el.querySelector<HTMLButtonElement>('.rc-ph .rc-btn')?.click();
		expect(closed).toHaveBeenCalled();
		// the tabs
		const tabs = vi.fn();
		c.tabChange.subscribe(tabs);
		const gapsTab = [...el.querySelectorAll<HTMLElement>('[role="tab"]')][1] as HTMLElement;
		gapsTab.click();
		gapsTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		expect(tabs).toHaveBeenCalledWith('gaps');
		fixture.detectChanges();
	});

	it('brings a line into view and flashes it, again for the same line', async () => {
		const { el, fixture } = render({ answer: file() });
		fixture.componentRef.setInput('line', { n: 3 });
		fixture.detectChanges();
		await Promise.resolve();
		expect(el.querySelector('[data-ln="3"]')?.classList).toContain('flash');
		fixture.componentRef.setInput('line', { n: 3 });
		fixture.detectChanges();
		await Promise.resolve();
		expect(el.querySelector('[data-ln="3"]')?.classList).toContain('flash');
		fixture.componentInstance.show(40);
		expect(el.querySelectorAll('.flash').length).toBe(1);
	});

	it('lists the gaps, each one a jump to its line', () => {
		const { el, jumps } = render({ answer: file(), tab: 'gaps' });
		const items = [...el.querySelectorAll<HTMLElement>('.rc-kv [role="button"]')];
		expect(
			items.map((i) => [...i.children].map((x) => x.textContent?.replace(/\s+/g, ' ').trim()).join(' | ')),
		).toEqual(['never false: a | line 2', 'never ran: return null; | line 3', 'never called: f() | line 4']);
		expect(items[1]?.querySelector('span span')?.className).toBe('red');
		items[1]?.click();
		items[2]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		expect(jumps).toEqual([
			{ path: 'apps/admin/src/pick.ts', line: 3, tab: 'lines' },
			{ path: 'apps/admin/src/pick.ts', line: 4, tab: 'lines' },
		]);
	});

	it('shows each failure with expected and received and where it went, then the tests beside the file', () => {
		const { el, jumps } = render({ answer: file(), tab: 'tests' });
		expect(el.textContent).toContain("expected 50 to be '50'");
		expect([...el.querySelectorAll('.rc-stat code')].map((x) => x.textContent?.trim())).toEqual(['"50"', '50']);
		el.querySelector<HTMLButtonElement>('.rc-content .rc-panel .rc-btn')?.click();
		expect(jumps).toEqual([{ path: 'apps/admin/src/pick.ts', line: 2, tab: 'lines' }]);
		expect(el.textContent).toContain('The report names no lines for this failure.');
		expect([...el.querySelectorAll('.rc-content .rc-kv span')].map((x) => x.className)).toEqual([
			'ok',
			'red',
			'muted',
		]);
		expect(el.textContent).toContain('pick > later');
	});

	it('runs a test file on this Mac with the PIN, and shows its output and any refusal', () => {
		const { el, c, fixture } = render({ answer: file(), tab: 'tests' });
		const asked: { spec: string; pin: string }[] = [];
		c.runSpec.subscribe((r) => asked.push(r));
		const buttons = [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
			b.textContent?.includes('on This Mac'),
		);
		expect(buttons.map((b) => b.textContent?.trim())).toEqual([
			'▶ Run pick.spec.ts on This Mac',
			'▶ Run other.spec.ts on This Mac',
		]);
		const pin = el.querySelector<HTMLInputElement>('input[type="password"]') as HTMLInputElement;
		pin.value = '135790';
		buttons[0]?.click();
		expect(asked).toEqual([{ spec: 'apps/admin/src/pick.spec.ts', pin: '135790' }]);
		expect(pin.value).toBe('');
		const job = (status: string) => ({
			id: 'j1',
			kind: 'tests',
			label: 'Run apps/admin/src/pick.spec.ts',
			status,
			startedAt: '2026-11-24T03:00:00.000Z',
			finishedAt: null,
			exitCode: null,
			lines: [
				{ seq: 1, stream: 'out', text: '✓ pick > keeps' },
				{ seq: 2, stream: 'err', text: 'a warning' },
			],
		});
		const pill = () => [...(el.querySelector('.rc-panel .rc-ph .rc-pill')?.classList ?? [])].sort().join(' ');
		fixture.componentRef.setInput('job', job('running'));
		fixture.detectChanges();
		expect(el.textContent).toContain('Output · Run apps/admin/src/pick.spec.ts');
		expect(pill()).toBe('cy rc-pill');
		expect(buttons[0]?.disabled).toBe(true);
		expect(
			[...(el.querySelector('.rc-content > .rc-panel')?.querySelectorAll('.rc-log .l') ?? [])].map((l) =>
				[...l.classList].sort().join(' '),
			),
		).toEqual(['l', 'l warn']);
		fixture.componentRef.setInput('job', job('passed'));
		fixture.detectChanges();
		expect(pill()).toBe('ok rc-pill');
		fixture.componentRef.setInput('job', job('failed'));
		fixture.componentRef.setInput('runMessage', 'Wrong PIN or password.');
		fixture.detectChanges();
		expect(pill()).toBe('rc-pill red');
		expect(el.textContent).toContain('Wrong PIN or password.');
	});

	it('says when nothing sits beside a file, when a file has no gaps, and shows only one side of a failure', () => {
		const lone = render({
			answer: file({
				specs: [],
				failures: [
					{ file: 'a.spec.ts', name: 'a', error: { name: 'Error', message: 'x', actual: '1', frames: [] } },
				],
			}),
			tab: 'tests',
		});
		expect([...lone.el.querySelectorAll('.rc-stat code')].map((x) => x.textContent?.trim())).toEqual(['—', '1']);
		expect(lone.el.textContent).not.toContain('No test file sits beside');
		TestBed.resetTestingModule();
		const empty = render({
			answer: file({ specs: [], failures: [], gaps: [], counts: null, changed: [], note: null }),
			tab: 'tests',
		});
		expect(empty.el.textContent).toContain('No test file sits beside this file');
		expect(empty.el.textContent).toContain('not measured');
		empty.c.step(1);
		expect(empty.jumps).toEqual([]);
		empty.fixture.componentRef.setInput('tab', 'gaps');
		empty.fixture.detectChanges();
		expect(empty.el.textContent).toContain('No gaps: every line');
		expect(empty.el.querySelector('a.rc-btn')).toBeNull();
	});

	it('waits for its answer, and shows nothing of a file it could not read', () => {
		const { c, el } = render({ answer: { state: 'not-connected', message: 'No key.' } });
		expect(el.textContent).toContain('No key.');
		expect(c['rows']()).toEqual([]);
		expect(c['marks']()).toEqual([]);
		expect(c['shares']()).toEqual([]);
		expect(c['name']()).toBe('');
		expect(c['runnable']()).toEqual([]);
		const strip = {
			currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) },
			clientY: 50,
		} as unknown as MouseEvent;
		c['stripAt'](strip);
		c.show(1);
		TestBed.resetTestingModule();
		const none = render({});
		expect(none.c['githubAt']()).toBeNull();
	});
});
