import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TipLayer, placeTip } from './tip-layer';

const VIEW = { width: 1000, height: 800 };
const TIP = { width: 120, height: 30 };
const at = (left: number, top: number, width = 40, height = 20) => ({
	left,
	top,
	right: left + width,
	bottom: top + height,
	height,
});

describe('where a hover name sits', () => {
	it('goes under its element, or above it when the window has no room below', () => {
		expect(placeTip(at(100, 100), TIP, VIEW, 'below')).toEqual({ left: 100, top: 128 });
		expect(placeTip(at(100, 770), TIP, VIEW, 'below')).toEqual({ left: 100, top: 732 });
		// Too little room above as well: it keeps to the top edge.
		expect(placeTip(at(100, 10, 40, 780), TIP, { width: 1000, height: 800 }, 'below').top).toBe(8);
	});

	it('never runs past the window’s left or right edge', () => {
		expect(placeTip(at(950, 100), TIP, VIEW, 'below').left).toBe(872);
		expect(placeTip(at(-30, 100), TIP, VIEW, 'below').left).toBe(8);
	});

	it('goes beside a menu item, centred on it and kept inside the window', () => {
		expect(placeTip(at(20, 100), TIP, VIEW, 'right')).toEqual({ left: 68, top: 95 });
		expect(placeTip(at(20, 790), TIP, VIEW, 'right').top).toBe(762);
		expect(placeTip(at(900, 100), TIP, VIEW, 'right').left).toBe(872);
	});
});

describe('the hover-name box', () => {
	afterEach(() => {
		TestBed.resetTestingModule();
		document.body.innerHTML = '';
	});

	function make() {
		const fixture = TestBed.createComponent(TipLayer);
		const layer = fixture.componentInstance;
		const host = document.createElement('div');
		host.innerHTML = `
			<button id="copy" data-tip="Copy"><span id="inside">⧉</span></button>
			<button id="plain">No name</button>
			<a id="nav" class="rc-nav off" data-tip="Appears once its feature is built">Service goals</a>`;
		document.body.append(host);
		const el = (id: string) => document.getElementById(id) as HTMLElement;
		return { layer, box: layer.box, el, fixture };
	}

	it('shows an element’s name over the page and follows the pointer and the keyboard', () => {
		const { layer, box, el } = make();
		expect(box.className).toBe('rc-tipbox');
		expect(box.getAttribute('role')).toBe('tooltip');
		expect(box.hidden).toBe(true);
		layer.enter({ target: el('inside') } as unknown as Event);
		expect(box.hidden).toBe(false);
		expect(box.textContent).toBe('Copy');
		expect(box.classList.contains('red')).toBe(false);
		expect(box.style.top).toMatch(/px$/);
		// The same element again changes nothing; moving within it keeps the name.
		layer.enter({ target: el('copy') } as unknown as Event);
		layer.leave({ relatedTarget: el('inside') } as unknown as Event);
		expect(box.hidden).toBe(false);
		// A switched-off menu item says why in red, beside the item.
		layer.enter({ target: el('nav') } as unknown as Event);
		expect(box.textContent).toBe('Appears once its feature is built');
		expect(box.classList.contains('red')).toBe(true);
		// Leaving for the page, or for nowhere, hides it.
		layer.leave({ relatedTarget: el('plain') } as unknown as Event);
		expect(box.hidden).toBe(true);
		layer.leave({ relatedTarget: null } as unknown as Event);
		expect(box.hidden).toBe(true);
	});

	it('shows nothing for an element without a name, or for the page itself', () => {
		const { layer, box, el } = make();
		layer.enter({ target: el('plain') } as unknown as Event);
		layer.enter({ target: document } as unknown as Event);
		expect(box.hidden).toBe(true);
	});

	it('changes with the name ("Copy" → "Copied") and goes when the name does', async () => {
		const { layer, box, el } = make();
		layer.enter({ target: el('copy') } as unknown as Event);
		el('copy').setAttribute('data-tip', 'Copied');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(box.textContent).toBe('Copied');
		el('copy').removeAttribute('data-tip');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(box.hidden).toBe(true);
	});

	it('moves with a scroll of the page or of a box in it, and stays put when nothing shows', () => {
		const { layer, box, el } = make();
		document.dispatchEvent(new Event('scroll'));
		expect(box.hidden).toBe(true);
		layer.enter({ target: el('copy') } as unknown as Event);
		const place = vi.spyOn(el('copy'), 'getBoundingClientRect');
		el('inside').dispatchEvent(new Event('scroll'));
		expect(place).toHaveBeenCalled();
		expect(box.hidden).toBe(false);
	});

	it('goes with Escape, and when its element leaves the page', () => {
		const { layer, box, el } = make();
		layer.check();
		layer.enter({ target: el('copy') } as unknown as Event);
		layer.check();
		expect(box.hidden).toBe(false);
		layer.hide();
		expect(box.hidden).toBe(true);
		layer.enter({ target: el('copy') } as unknown as Event);
		layer.leave({ relatedTarget: null } as unknown as Event);
		expect(box.hidden).toBe(true);
		layer.enter({ target: el('copy') } as unknown as Event);
		el('copy').remove();
		layer.check();
		expect(box.hidden).toBe(true);
	});

	it('leaves the page with the console', () => {
		const { box, fixture } = make();
		expect(box.isConnected).toBe(true);
		fixture.destroy();
		expect(box.isConnected).toBe(false);
	});
});
