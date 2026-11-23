import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CoverageMap } from './coverage-map';

import type { CoverageNode } from '@saha-textile/release-console-contracts';

const ROOT: CoverageNode = {
	n: 'saha-textile',
	c: [60, 100, 0, 0, 0, 0, 60, 100],
	k: [
		{
			n: 'apps',
			c: [50, 80, 0, 0, 0, 0, 50, 80],
			k: [
				{ n: 'admin', c: [40, 60, 0, 0, 0, 0, 40, 60], k: [{ n: 'a.ts', c: [40, 60, 0, 0, 0, 0, 40, 60] }] },
				{ n: 'b.ts', c: [10, 20, 0, 0, 0, 0, 10, 20] },
			],
		},
		{ n: 'tiny.ts', c: [10, 10, 0, 0, 0, 0, 10, 10] },
		{ n: 'README.md', c: null },
		{ n: 'empty.ts', c: [0, 0, 0, 0, 0, 0, 0, 0] },
	],
};

/** The browser's resize watcher, as a test can drive it. */
class Watcher {
	static last: Watcher | null = null;
	readonly disconnect = vi.fn();
	constructor(readonly call: () => void) {
		Watcher.last = this;
	}
	observe(): void {}
}

function render(focusPath = '') {
	vi.stubGlobal('ResizeObserver', Watcher);
	const fixture = TestBed.createComponent(CoverageMap);
	fixture.componentRef.setInput('root', ROOT);
	fixture.componentRef.setInput('focusPath', focusPath);
	fixture.detectChanges();
	const el = fixture.nativeElement as HTMLElement;
	const area = el.querySelector<HTMLElement>('.rc-cov-map') as HTMLElement;
	Object.defineProperty(area, 'clientWidth', { value: 600, configurable: true });
	Object.defineProperty(area, 'clientHeight', { value: 400, configurable: true });
	Watcher.last?.call();
	fixture.detectChanges();
	return { fixture, el, c: fixture.componentInstance };
}

describe('the map', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('draws a folder’s measured contents as boxes sized by code, coloured by coverage', () => {
		const { el } = render();
		const boxes = [...el.querySelectorAll<HTMLButtonElement>('.rc-cov-map > .rc-cov-box')];
		expect(boxes.map((b) => [b.title, [...b.classList].sort().join(' ')])).toEqual([
			['apps · 62.5% of 80 statements', 'rc-cov-box red'],
			['tiny.ts · 100% of 10 statements', 'ok rc-cov-box'],
		]);
		expect(boxes[0]?.querySelector('b')?.textContent).toBe('apps');
		expect(boxes[0]?.querySelectorAll('.rc-cov-box').length).toBe(2);
		expect(el.querySelector('b')?.textContent).toBe('saha-textile');
	});

	it('goes inside a folder box, opens a file box, and walks back along the trail', () => {
		const { el, c, fixture } = render('apps');
		const focus = vi.fn();
		const open = vi.fn();
		c.focus.subscribe(focus);
		c.open.subscribe(open);
		const boxes = [...el.querySelectorAll<HTMLButtonElement>('.rc-cov-map > .rc-cov-box')];
		expect(boxes.map((b) => b.title.split(' ·')[0])).toEqual(['apps/admin', 'apps/b.ts']);
		boxes[0]?.click();
		boxes[1]?.click();
		expect(focus).toHaveBeenCalledWith('apps/admin');
		expect(open).toHaveBeenCalledWith('apps/b.ts');
		el.querySelector<HTMLButtonElement>('.rc-row .rc-btn')?.click();
		expect(focus).toHaveBeenLastCalledWith('');
		fixture.destroy();
		expect(Watcher.last?.disconnect).toHaveBeenCalled();
	});

	it('shows the whole codebase for a folder that is gone, and says when a folder has nothing measured', () => {
		const gone = render('apps/nowhere');
		expect(gone.el.querySelectorAll('.rc-cov-map > .rc-cov-box').length).toBe(2);
		TestBed.resetTestingModule();
		const small = render('apps/admin');
		expect(small.el.querySelector('.rc-cov-box b')?.textContent).toBe('a.ts');
		TestBed.resetTestingModule();
		// a trail that ends at a file shows nothing inside it
		const file = render('tiny.ts');
		expect(file.el.textContent).toContain('Nothing in this folder has code the tests run.');
		TestBed.resetTestingModule();
		vi.stubGlobal('ResizeObserver', Watcher);
		const fixture = TestBed.createComponent(CoverageMap);
		fixture.componentRef.setInput('root', { n: 'r', c: null, k: [{ n: 'README.md', c: null }] });
		fixture.detectChanges();
		expect((fixture.nativeElement as HTMLElement).textContent).toContain(
			'Nothing in this folder has code the tests run.',
		);
	});
});
