import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BranchPicker, branchWhere, matchBranches } from './branch-picker';

import type { Branch } from '@saha-textile/release-console-contracts';

/** The picker's members these tests use (protected on the component). */
interface Picker {
	open: { set(v: boolean): void; (): boolean };
	query: { set(v: string): void };
	active: () => number;
	place: () => { maxHeight: number };
	hits: () => Branch[];
	where(b: Branch): string;
	openList(): void;
	pick(name: string): void;
	key(e: KeyboardEvent): void;
}

const branch = (name: string, onGitHub = true, onThisComputer = false): Branch => ({ name, onGitHub, onThisComputer });
const BRANCHES = [branch('feature/main-menu'), branch('main'), branch('maintenance'), branch('dev', false, true)];

function make(options: { popoverOpen?: boolean; withBox?: boolean } = {}) {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(BranchPicker, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(BranchPicker);
	fixture.componentRef.setInput('branches', BRANCHES);
	fixture.componentRef.setInput('defaultBranch', 'main');
	const c = fixture.componentInstance as unknown as Picker;
	const box = document.createElement('input');
	box.getBoundingClientRect = () =>
		({ top: 100, bottom: 130, left: 10, width: 200, right: 210, height: 30 }) as DOMRect;
	const list = Object.assign(document.createElement('div'), {
		matches: vi.fn(() => options.popoverOpen ?? false),
		showPopover: vi.fn(),
	});
	Object.defineProperty(c, 'box', { value: () => (options.withBox === false ? undefined : { nativeElement: box }) });
	Object.defineProperty(c, 'list', { value: () => ({ nativeElement: list }) });
	const picked = vi.fn();
	fixture.componentInstance.picked.subscribe(picked);
	fixture.detectChanges();
	return { c, fixture, list, picked };
}
const key = (k: string) => ({ key: k, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

afterEach(() => {
	vi.useRealTimers();
});

describe('branch matching and words', () => {
	it('ranks an exact name, then names that start with the text, then names that contain it', () => {
		expect(matchBranches(BRANCHES, 'main').map((b) => b.name)).toEqual([
			'main',
			'maintenance',
			'feature/main-menu',
		]);
		expect(matchBranches([branch('main-b'), branch('main-a')], 'main').map((b) => b.name)).toEqual([
			'main-a',
			'main-b',
		]);
		expect(matchBranches(BRANCHES, 'zzz')).toEqual([]);
	});

	it('says where a branch lives', () => {
		expect(branchWhere(branch('x'), null, null)).toBe('on GitHub');
		expect(branchWhere(branch('x', false, true), null, 'x')).toBe(
			'checked out on this computer · only on this computer',
		);
	});
});

describe('the branch picker', () => {
	it('opens its list beside the box and keeps it there while open', () => {
		vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
		const { c, list, fixture } = make();
		expect(list.showPopover).toHaveBeenCalled();
		c.openList();
		expect(c.open()).toBe(true);
		expect(c.place().maxHeight).toBeGreaterThan(0);
		vi.advanceTimersByTime(50);
		c.open.set(false);
		vi.advanceTimersByTime(50);
		fixture.destroy();
	});

	it('leaves an open popover as it is, and measures nothing without its box', () => {
		const { c, list } = make({ popoverOpen: true, withBox: false });
		expect(list.showPopover).not.toHaveBeenCalled();
		c.openList();
		expect(c.where(branch('main'))).toContain('default branch');
	});

	it('puts a page’s own word first on a branch’s row', () => {
		const { c, fixture } = make();
		fixture.componentRef.setInput('notes', { main: 'the base now' });
		expect(c.where(branch('main'))).toBe('the base now · default branch · on GitHub');
		expect(c.where(branch('maintenance'))).toBe('on GitHub');
	});

	it('moves through the list with the arrows, picks with Enter and closes with Escape', () => {
		const { c, picked } = make();
		c.openList();
		c.query.set('main');
		c.key(key('ArrowDown'));
		c.key(key('ArrowDown'));
		c.key(key('ArrowUp'));
		expect(c.active()).toBe(1);
		c.key(key('Enter'));
		expect(picked).toHaveBeenCalledWith('maintenance');
		expect(c.open()).toBe(false);
		c.openList();
		c.key(key('Escape'));
		expect(c.open()).toBe(false);
		const other = key('a');
		c.key(other);
		expect(other.preventDefault).not.toHaveBeenCalled();
		c.query.set('zzz');
		c.key(key('ArrowDown'));
		c.key(key('ArrowUp'));
		c.key(key('Enter'));
		expect(picked).toHaveBeenCalledTimes(1);
	});
});
