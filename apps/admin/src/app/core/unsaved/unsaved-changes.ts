import { Injectable } from '@angular/core';

/**
 * The browser's "Leave site? Changes you made may not be saved" on a reload or tab close, for every
 * admin form, locked or not (owner, 2026-11-20).
 *
 * It needs nothing from each screen. Angular marks an edited reactive or template form with the
 * `ng-dirty` class, and this service notes when each form was last typed into. A form counts as
 * unsaved when it is dirty AND was edited after the last successful save (any change request the
 * admin sent that came back fine), so a form that saved but stayed "dirty" in Angular's eyes does
 * not nag. Search boxes and anything inside `[data-unsaved="off"]` never count, nor do the sign-in
 * pages.
 *
 * Screens whose unsaved work is not a form (the shipping rule builder) register a check instead.
 * The browser shows its own wording and its own Leave / Cancel buttons; a page cannot change them.
 */
@Injectable({ providedIn: 'root' })
export class UnsavedChanges {
	private readonly checks = new Set<() => boolean>();
	private readonly editedAt = new WeakMap<Element, number>();
	private lastSavedAt = 0;
	private started = false;
	private doc: Document | null = null;

	private readonly onEdit = (event: Event) => {
		const target = event.target as Element | null;
		const form = target?.closest?.('form');
		if (form) this.editedAt.set(form, Date.now());
	};

	private readonly onBeforeUnload = (event: BeforeUnloadEvent) => {
		if (!this.hasUnsaved()) return;
		event.preventDefault();
		// Older browsers need a value set; every browser shows its own text, never this one.
		event.returnValue = '';
	};

	start(doc: Document): void {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;
		this.doc = doc;
		doc.addEventListener('input', this.onEdit, true);
		doc.addEventListener('change', this.onEdit, true);
		window.addEventListener('beforeunload', this.onBeforeUnload);
	}

	/** For unsaved work that is not a form. Returns the function that removes the check. */
	register(check: () => boolean): () => void {
		this.checks.add(check);
		return () => this.checks.delete(check);
	}

	/** A change request came back fine: forms edited before now count as saved. */
	markSaved(at: number = Date.now()): void {
		this.lastSavedAt = Math.max(this.lastSavedAt, at);
	}

	hasUnsaved(): boolean {
		for (const check of this.checks) {
			try {
				if (check()) return true;
			} catch {
				// A screen that can't answer is not unsaved work.
			}
		}
		const doc = this.doc;
		if (!doc || doc.location?.pathname.startsWith('/auth/')) return false;
		for (const form of Array.from(doc.querySelectorAll('form.ng-dirty'))) {
			if (form.closest('[data-unsaved="off"]')) continue;
			if ((this.editedAt.get(form) ?? 0) <= this.lastSavedAt) continue;
			if (hasRealEdit(form)) return true;
		}
		return false;
	}
}

/** Dirty fields that are real work: not a search box, not a filter marked off. */
function hasRealEdit(form: Element): boolean {
	const dirty = Array.from(form.querySelectorAll('.ng-dirty'));
	if (dirty.length === 0) return true; // a custom control marked only the form
	return dirty.some((field) => {
		if (field.closest('[data-unsaved="off"], .table-search, .search-full')) return false;
		if (field instanceof HTMLInputElement && field.type === 'search') return false;
		return true;
	});
}
