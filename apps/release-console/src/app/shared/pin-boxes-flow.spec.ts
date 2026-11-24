import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { PinBoxes, fillDigits } from './pin-boxes';

/** The boxes' members these tests use (protected on the component). */
interface Boxes {
	digits: () => string[];
	value: () => string;
	type(i: number, box: HTMLInputElement): void;
	key(i: number, e: KeyboardEvent): void;
	clear(): void;
}

function make(inputs: Record<string, unknown> = {}) {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(PinBoxes, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(PinBoxes);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	const c = fixture.componentInstance as unknown as Boxes;
	// The six boxes, as the template would draw them.
	const inputs6 = Array.from({ length: 6 }, () => document.createElement('input'));
	const focused = inputs6.map((box) => vi.spyOn(box, 'focus'));
	Object.defineProperty(c, 'boxes', { value: () => inputs6.map((nativeElement) => ({ nativeElement })) });
	const complete = vi.fn();
	const changed = vi.fn();
	fixture.componentInstance.complete.subscribe(complete);
	fixture.componentInstance.changed.subscribe(changed);
	fixture.detectChanges();
	return { c, fixture, inputs6, focused, complete, changed };
}
const key = (k: string) => ({ key: k, preventDefault: vi.fn() }) as unknown as KeyboardEvent;
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('spreading digits over the boxes', () => {
	it('fills from the box typed in, stops at the sixth, and empties a box when nothing is typed', () => {
		const empty = Array<string>(6).fill('');
		expect(fillDigits(empty, 4, '1234')).toEqual({ digits: ['', '', '', '', '1', '2'], focus: 5 });
		expect(fillDigits(['1', '', '', '', '', ''], 0, 'x')).toEqual({ digits: empty, focus: 0 });
	});
});

describe('the PIN boxes', () => {
	it('take the keyboard once when they appear, and leave it when the page asks', async () => {
		const on = make();
		await settle();
		expect(on.focused[0]).toHaveBeenCalledTimes(1);
		on.fixture.detectChanges();
		await settle();
		expect(on.focused[0]).toHaveBeenCalledTimes(1);
		const off = make({ autofocus: false });
		await settle();
		expect(off.focused[0]).not.toHaveBeenCalled();
	});

	it('sends the full PIN at the sixth digit, but not while the boxes are disabled', async () => {
		const { c, inputs6, complete, changed } = make();
		const box = inputs6[0] as HTMLInputElement;
		box.value = '123456';
		c.type(0, box);
		expect(box.value).toBe('1');
		expect(changed).toHaveBeenLastCalledWith('123456');
		expect(complete).toHaveBeenCalledWith('123456');
		await settle();
		const locked = make({ disabled: true });
		const first = locked.inputs6[0] as HTMLInputElement;
		first.value = '654321';
		locked.c.type(0, first);
		expect(locked.complete).not.toHaveBeenCalled();
		first.value = '';
		locked.c.type(0, first);
		expect(locked.c.value()).toBe('54321');
	});

	it('moves back with Backspace on an empty box, and with the arrows inside the six', async () => {
		const { c, inputs6, focused, changed } = make({ autofocus: false });
		const second = inputs6[1] as HTMLInputElement;
		const first = inputs6[0] as HTMLInputElement;
		first.value = '7';
		c.type(0, first);
		second.value = '8';
		c.type(1, second);
		await settle();
		// Backspace on a filled box leaves it to the browser.
		const onFilled = key('Backspace');
		c.key(1, onFilled);
		expect(onFilled.preventDefault).not.toHaveBeenCalled();
		// Backspace on an empty box clears the one before it and moves there.
		const onEmpty = key('Backspace');
		c.key(2, onEmpty);
		expect(onEmpty.preventDefault).toHaveBeenCalled();
		expect(c.digits()).toEqual(['7', '', '', '', '', '']);
		expect(changed).toHaveBeenLastCalledWith('7');
		await settle();
		expect(focused[1]).toHaveBeenCalled();
		// The first box has nothing before it.
		c.digits().fill('');
		c.key(0, key('Backspace'));
		c.key(0, key('ArrowLeft'));
		c.key(5, key('ArrowRight'));
		c.key(3, key('Tab'));
		focused.forEach((spy) => spy.mockClear());
		await settle();
		expect(focused.every((spy) => spy.mock.calls.length === 0)).toBe(true);
		c.key(3, key('ArrowLeft'));
		c.key(3, key('ArrowRight'));
		await settle();
		expect(focused[2]).toHaveBeenCalled();
		expect(focused[4]).toHaveBeenCalled();
	});

	it('empties every box and puts the keyboard back in the first after the next render', async () => {
		const { c, inputs6, focused, changed } = make({ autofocus: false });
		const box = inputs6[0] as HTMLInputElement;
		box.value = '42';
		c.type(0, box);
		c.clear();
		expect(c.value()).toBe('');
		expect(changed).toHaveBeenLastCalledWith('');
		TestBed.inject(ApplicationRef).tick();
		await settle();
		expect(focused[0]).toHaveBeenCalled();
	});
});
