import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, inject } from '@angular/core';

/** Room kept between a hover name and what it names, and between it and the window's edges. */
const GAP = 8;
const EDGE = 8;

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(n, Math.max(low, high)));

/**
 * Where a hover name sits: beside a menu item (as the menu has always drawn it), otherwise under the element, or
 * above it when the window has no room below; never past the window's edges.
 */
export function placeTip(
	anchor: { left: number; top: number; right: number; bottom: number; height: number },
	tip: { width: number; height: number },
	view: { width: number; height: number },
	side: 'right' | 'below',
): { left: number; top: number } {
	if (side === 'right')
		return {
			left: clamp(anchor.right + GAP, EDGE, view.width - tip.width - EDGE),
			top: clamp(anchor.top + anchor.height / 2 - tip.height / 2, EDGE, view.height - tip.height - EDGE),
		};
	const below = anchor.bottom + GAP;
	return {
		left: clamp(anchor.left, EDGE, view.width - tip.width - EDGE),
		top: below + tip.height + EDGE <= view.height ? below : Math.max(EDGE, anchor.top - GAP - tip.height),
	};
}

/**
 * Every hover name in the console (`data-tip`), drawn in one box above the page (owner, 26 Nov: "Copy" was cut
 * off). A name drawn inside its own button was cut by the button's angled shape and by any box that scrolls; this
 * box belongs to no element, so nothing cuts it. It follows the pointer and the keyboard, changes when the name
 * does ("Copy" → "Copied"), moves with a scroll, and goes with Escape or when its element goes.
 */
@Component({
	selector: 'rc-tip-layer',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: '',
	host: {
		'(document:pointerover)': 'enter($event)',
		'(document:focusin)': 'enter($event)',
		'(document:pointerout)': 'leave($event)',
		'(document:focusout)': 'leave($event)',
		'(document:keydown.escape)': 'hide()',
		'(document:pointermove)': 'check()',
	},
})
export class TipLayer {
	private readonly doc = inject(DOCUMENT);
	readonly box: HTMLDivElement = this.doc.createElement('div');
	private anchor: Element | null = null;
	private watch: MutationObserver | null = null;

	constructor() {
		this.box.className = 'rc-tipbox';
		this.box.setAttribute('role', 'tooltip');
		this.box.hidden = true;
		this.doc.body.append(this.box);
		// A scroll anywhere (the page, or a box that scrolls inside it) moves the name with its element.
		const follow = () => {
			if (this.anchor) this.draw(this.anchor);
		};
		this.doc.addEventListener('scroll', follow, true);
		inject(DestroyRef).onDestroy(() => {
			this.doc.removeEventListener('scroll', follow, true);
			this.hide();
			this.box.remove();
		});
	}

	enter(e: Event): void {
		const el = (e.target as Element).closest?.('[data-tip]') ?? null;
		if (!el || el === this.anchor) return;
		this.hide();
		this.anchor = el;
		// The name can change while it shows ("Copy" → "Copied").
		this.watch = new MutationObserver(() => this.draw(el));
		this.watch.observe(el, { attributes: true, attributeFilter: ['data-tip'] });
		this.draw(el);
	}

	leave(e: Event): void {
		const to = (e as FocusEvent).relatedTarget as Node | null;
		if (this.anchor && to && this.anchor.contains(to)) return;
		this.hide();
	}

	/** A name whose element left the page (a screen changed under the pointer) goes with it. */
	check(): void {
		if (this.anchor && !this.anchor.isConnected) this.hide();
	}

	hide(): void {
		this.anchor = null;
		this.watch?.disconnect();
		this.watch = null;
		this.box.hidden = true;
	}

	private draw(el: Element): void {
		const text = el.getAttribute('data-tip');
		if (!text) return this.hide();
		this.box.textContent = text;
		this.box.classList.toggle('red', el.matches('.rc-nav.off, .rc-chip.off'));
		this.box.hidden = false;
		const view = this.doc.defaultView as Window;
		const at = placeTip(
			el.getBoundingClientRect(),
			this.box.getBoundingClientRect(),
			{ width: view.innerWidth, height: view.innerHeight },
			el.matches('.rc-nav') ? 'right' : 'below',
		);
		this.box.style.left = `${at.left}px`;
		this.box.style.top = `${at.top}px`;
	}
}
