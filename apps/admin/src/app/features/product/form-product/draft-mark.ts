import { DestroyRef, Directive, ElementRef, InjectionToken, Renderer2, effect, inject, untracked } from '@angular/core';
import { NgControl } from '@angular/forms';

/** What the product form tells a field about its draft of changes. */
export interface DraftMarks {
	/** The "Changed · was: …" line for this control, or null when it has not changed. Reads signals. */
	wasFor(path: readonly string[] | null): string | null;
}

export const DRAFT_MARKS = new InjectionToken<DraftMarks>('DraftMarks');

/**
 * Brief 7d: a field changed in a draft of changes gets the amber outline (`border-warning`) and the
 * old value under it (`text-warning`). Bootstrap's own classes; nothing new is drawn.
 */
@Directive({ selector: '[formControlName]' })
export class DraftMarkDirective {
	private readonly control = inject(NgControl, { self: true, optional: true });
	private readonly marks = inject(DRAFT_MARKS, { optional: true });
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	private readonly renderer = inject(Renderer2);
	private note: HTMLElement | null = null;

	constructor() {
		if (!this.marks) return;
		effect(() => {
			const was = this.marks?.wasFor(this.control?.path ?? null) ?? null;
			untracked(() => this.show(was));
		});
		inject(DestroyRef).onDestroy(() => this.show(null));
	}

	private show(was: string | null): void {
		const host = this.host.nativeElement;
		if (was) this.renderer.addClass(host, 'border-warning');
		else this.renderer.removeClass(host, 'border-warning');
		const anchor = (host.closest('.input-group') as HTMLElement | null) ?? host;
		if (!was) {
			this.note?.remove();
			this.note = null;
			return;
		}
		if (!this.note) {
			this.note = this.renderer.createElement('div') as HTMLElement;
			this.renderer.addClass(this.note, 'text-warning');
			this.renderer.addClass(this.note, 'small');
			this.renderer.addClass(this.note, 'mt-1');
			const parent = anchor.parentNode;
			if (parent) this.renderer.insertBefore(parent, this.note, anchor.nextSibling);
		}
		this.note.textContent = was;
	}
}
