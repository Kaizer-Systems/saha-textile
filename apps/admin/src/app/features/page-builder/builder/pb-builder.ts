import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, HostListener, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbDropdownModule, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { lastValueFrom } from 'rxjs';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { type AdminLayoutView, type PageSection, PageBuilderGateway } from '@core/page-builder/page-builder.gateway';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

import {
	UndoHistory,
	duplicateSection,
	insertSection,
	moveSection,
	newSection,
	removeSection,
	replaceSection,
} from './builder-state';
import { PbAddSection, type PbAddChoice } from './pb-add-section';
import { type GoLiveOutcome, PbGoLive } from './pb-go-live';
import { PbHistory, type SessionLine } from './pb-history';
import { PbPreview } from './pb-preview';
import { PbSectionForm } from './pb-section-form';

/** The save line in the top bar (FX-23): saved, saving, or not saved and retrying; or why it cannot save. */
export type SaveState = 'saved' | 'saving' | 'retrying' | 'conflict' | 'locked' | 'refused';

/** Wait after the last change before saving, so typing saves once (each change saves within a second). */
export const SAVE_DELAY_MS = 800;
/** The editing lock's heartbeat (FX-11: free after 2 minutes without one). */
export const HEARTBEAT_MS = 30_000;
/** Waits between tries after a failed save, longest last. */
export const RETRY_MS = [2_000, 5_000, 10_000, 30_000] as const;

/** Unsaved changes kept in the tab (FX-23), so a reload or a dropped network loses nothing. */
const unsavedKey = (layoutId: string) => `pb_unsaved_${layoutId}`;

/**
 * Page Builder › a layout (brief B1–B9, step 5). Left, the outline: sections in order, moved by dragging, by the ⋮
 * menu or by keyboard (Space picks a row up, ↑ ↓ move it, Space drops it, Esc puts it back; SG-8). Middle, the shop
 * at the chosen size (preview, step 6). Right, the chosen section's Content and Look (SG-4). Every change saves within
 * a second over the revision it started from; a failed save keeps the changes in the tab and retries (FX-23). One
 * admin edits at a time (E4); undo and redo cover every change (E3).
 */
@Component({
	selector: 'app-pb-builder',
	templateUrl: './pb-builder.html',
	imports: [
		CdkDrag,
		CdkDragHandle,
		CdkDropList,
		LanguageSwitch,
		NgbDropdownModule,
		PbPreview,
		PbSectionForm,
		RouterLink,
		TranslocoModule,
	],
})
export class PbBuilder {
	private readonly gateway = inject(PageBuilderGateway);
	private readonly modals = inject(NgbModal);
	private readonly toastr = inject(ToastrService);
	private readonly transloco = inject(TranslocoService);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
	readonly pageType = (this.route.snapshot.paramMap.get('type') ?? 'home').toLowerCase();
	readonly layoutId = this.route.snapshot.paramMap.get('id') ?? '';
	readonly locales = inject(ActiveLanguages).list();

	readonly view = signal<AdminLayoutView | null>(null);
	readonly sections = signal<PageSection[]>([]);
	readonly selectedId = signal<string | null>(null);
	readonly locale = signal(this.locales[0] ?? 'en');
	readonly saveState = signal<SaveState>('saved');
	/** Who saved over this layout, for the conflict line; who holds the lock, for the read-only line. */
	readonly blocker = signal<{ name: string | null; at: string | null } | null>(null);
	/** Phone: one pane at a time (B9). */
	readonly pane = signal<'outline' | 'settings' | 'preview'>('outline');
	/** Keyboard moving (SG-8): the row picked up, and where it started. */
	readonly lifted = signal<{ id: string; from: number } | null>(null);
	/** Read out to screen readers after each move (SG-8). */
	readonly announcement = signal('');
	readonly canUndo = signal(false);
	readonly canRedo = signal(false);

	readonly selected = computed(() => this.sections().find((section) => section.id === this.selectedId()) ?? null);
	/** Someone else is editing (E4): look and preview only. */
	readonly readOnly = computed(() => this.saveState() === 'locked');
	/** The outline picture of the sections shown (hidden ones left out), as the layout cards draw it. */
	readonly outline = computed(() =>
		this.sections()
			.filter((section) => !section.hidden)
			.map((section) => ({
				type: section.type,
				arrangement: section.type === 'banner_arrangement' ? section.arrangement : null,
			})),
	);
	/** What holds Go Live, counted for the top bar (E1). */
	readonly problemCount = computed(() => this.view()?.problems.length ?? 0);

	private readonly history = new UndoHistory<PageSection[]>();
	/** This session's changes, one per undo step (E3); undone steps wait here until redone or replaced. */
	private steps: Omit<SessionLine, 'steps'>[] = [];
	private undoneSteps: Omit<SessionLine, 'steps'>[] = [];
	private draftId: string | null = null;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private retryAt = 0;
	private heartbeat: ReturnType<typeof setInterval> | null = null;

	constructor() {
		void this.load();
		inject(DestroyRef).onDestroy(() => this.close());
	}

	private async load(): Promise<void> {
		try {
			const view = await lastValueFrom(this.gateway.layout(this.layoutId));
			this.view.set(view);
			this.draftId = view.draft?.id ?? null;
			this.sections.set(this.restoreUnsaved(view) ?? view.draft?.sections ?? []);
			this.selectedId.set(this.sections()[0]?.id ?? null);
			await this.takeLock();
			if (this.isBrowser) this.heartbeat = setInterval(() => void this.takeLock(), HEARTBEAT_MS);
		} catch (error) {
			this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'));
		}
	}

	/** E4: the lock is taken on opening and kept by a heartbeat; held by someone else, the builder only looks. */
	private async takeLock(): Promise<void> {
		try {
			const answer = await lastValueFrom(this.gateway.lock(this.layoutId));
			if (answer.granted) {
				if (this.saveState() === 'locked') this.saveState.set('saved');
				this.blocker.set(null);
			} else {
				this.saveState.set('locked');
				this.blocker.set({ name: answer.lock.holderName, at: answer.lock.since });
			}
		} catch {
			// The next beat tries again; saving keeps its own retries.
		}
	}

	/** Unsaved changes kept in this tab from a save that never landed, when they are newer than the draft. */
	private restoreUnsaved(view: AdminLayoutView): PageSection[] | null {
		if (!this.isBrowser) return null;
		try {
			const raw = sessionStorage.getItem(unsavedKey(this.layoutId));
			if (!raw) return null;
			const kept = JSON.parse(raw) as { draftId: string | null; sections: PageSection[] };
			if (kept.draftId !== (view.draft?.id ?? null)) return null;
			this.saveState.set('retrying');
			this.scheduleSave(0);
			return kept.sections;
		} catch {
			return null;
		}
	}

	// ── Changes ────────────────────────────────────────────────────────────────────────────────────────────

	/** Every change goes through here: one undo step (named for History, E3), then a save within a second. */
	change(next: PageSection[], key = 'pb_log_changed', params: Record<string, unknown> = {}): void {
		if (this.readOnly()) return;
		this.history.record(this.sections());
		this.logStep(key, params);
		this.sections.set(next);
		this.syncHistory();
		this.scheduleSave(SAVE_DELAY_MS);
	}

	updateSection(section: PageSection, key = 'pb_log_changed'): void {
		try {
			this.change(replaceSection(this.sections(), section), key, { name: this.sectionName(section) });
		} catch {
			this.toastr.error(this.transloco.translate('pb_value_refused'));
		}
	}

	async addSection(): Promise<void> {
		const view = this.view();
		if (!view || this.readOnly()) return;
		const ref = this.modals.open(PbAddSection, { centered: true, size: 'lg', scrollable: true });
		(ref.componentInstance as PbAddSection).start(view.allowedSections);
		const choice = (await ref.result.catch(() => null)) as PbAddChoice | null;
		if (!choice) return;
		const ids = this.sections().map((section) => section.id);
		const section =
			choice.kind === 'type'
				? newSection(choice.type, ids)
				: {
						...structuredClone(choice.block.section),
						id: newSection(choice.block.section.type, ids).id,
						block: { id: choice.block.id, linked: choice.linked },
					};
		this.change(insertSection(this.sections(), section as PageSection, this.selectedId()), 'pb_log_added', {
			name: this.sectionName(section as PageSection),
		});
		this.selectedId.set(section.id);
		this.pane.set('settings');
	}

	move(from: number, to: number): void {
		const moved = this.sections()[from];
		this.change(moveSection(this.sections(), from, to), 'pb_log_moved', {
			name: moved ? this.sectionName(moved) : '',
		});
	}

	drop(event: CdkDragDrop<PageSection[]>): void {
		if (event.previousIndex !== event.currentIndex) this.move(event.previousIndex, event.currentIndex);
	}

	duplicate(id: string): void {
		const copy = duplicateSection(this.sections(), id);
		const source = this.sections().find((section) => section.id === id);
		this.change(copy.sections, 'pb_log_duplicated', { name: source ? this.sectionName(source) : '' });
		this.selectedId.set(copy.id);
	}

	toggleHidden(section: PageSection): void {
		this.updateSection({ ...section, hidden: !section.hidden }, section.hidden ? 'pb_log_shown' : 'pb_log_hidden');
	}

	/** Delete with an Undo toast instead of a confirm dialog (Six points of view: UI/UX). */
	remove(id: string): void {
		const gone = this.sections().find((section) => section.id === id);
		this.change(removeSection(this.sections(), id), 'pb_log_removed', { name: gone ? this.sectionName(gone) : '' });
		if (this.selectedId() === id) this.selectedId.set(this.sections()[0]?.id ?? null);
		const toast = this.toastr.info(this.transloco.translate('pb_section_removed'), '', { timeOut: 8000 });
		toast.onTap.subscribe(() => this.undo());
	}

	/** P7: the section kept as a block; the section here becomes its linked copy only if chosen later. */
	async saveAsBlock(section: PageSection): Promise<void> {
		const name = this.transloco.translate('pb_section_' + section.type);
		try {
			await lastValueFrom(this.gateway.createBlock({ name, section }));
			this.toastr.success(this.transloco.translate('pb_block_saved'));
		} catch (error) {
			this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'));
		}
	}

	// ── Undo, redo, keyboard ────────────────────────────────────────────────────────────────────────────────

	undo(): void {
		const previous = this.history.undo(this.sections());
		if (!previous) return;
		// Every history entry was recorded with its step, so there is one to move.
		this.undoneSteps.push(this.steps.pop() as Omit<SessionLine, 'steps'>);
		this.sections.set(previous);
		this.afterHistory();
	}

	redo(): void {
		const next = this.history.redo(this.sections());
		if (!next) return;
		// Undone entries keep their steps the same way.
		this.steps.push(this.undoneSteps.pop() as Omit<SessionLine, 'steps'>);
		this.sections.set(next);
		this.afterHistory();
	}

	private afterHistory(): void {
		if (!this.sections().some((section) => section.id === this.selectedId())) {
			this.selectedId.set(this.sections()[0]?.id ?? null);
		}
		this.syncHistory();
		this.scheduleSave(SAVE_DELAY_MS);
	}

	private syncHistory(): void {
		this.canUndo.set(this.history.canUndo);
		this.canRedo.set(this.history.canRedo);
	}

	/** ⌘/Ctrl + Z and ⌘/Ctrl + Shift + Z, except while typing in a field. */
	@HostListener('document:keydown', ['$event'])
	onKey(event: KeyboardEvent): void {
		if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
		event.preventDefault();
		if (event.shiftKey) this.redo();
		else this.undo();
	}

	/** SG-8: Space picks a row up and drops it, ↑ ↓ move it, Esc puts it back; each step is read out. */
	outlineKey(event: KeyboardEvent, section: PageSection, index: number): void {
		if (this.readOnly()) return;
		const lifted = this.lifted();
		const name = this.sectionName(section);
		const count = this.sections().length;
		if (event.key === ' ') {
			event.preventDefault();
			if (!lifted) {
				this.liftedFrom = this.sections();
				this.lifted.set({ id: section.id, from: index });
				this.announce('pb_kb_lifted', { name, position: index + 1, count });
			} else {
				this.dropLifted();
				this.announce('pb_kb_dropped', { name, position: index + 1, count });
			}
			return;
		}
		if (!lifted || lifted.id !== section.id) return;
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			const to = event.key === 'ArrowUp' ? index - 1 : index + 1;
			if (to < 0 || to >= count) return;
			this.sections.set(moveSection(this.sections(), index, to));
			this.announce('pb_kb_moved', { name, position: to + 1, count });
			this.focusRow(section.id);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			// A row is only ever lifted together with the order from before.
			this.sections.set(this.liftedFrom as PageSection[]);
			this.liftedFrom = null;
			this.lifted.set(null);
			this.announce('pb_kb_cancelled', { name, position: lifted.from + 1, count });
			this.focusRow(section.id);
		}
	}

	/** Leaving the outline drops a row still held, where it is. */
	outlineBlur(): void {
		if (this.lifted()) this.dropLifted();
	}

	/** The order before a keyboard move: one undo step when the row is dropped elsewhere. */
	private liftedFrom: PageSection[] | null = null;

	private dropLifted(): void {
		const liftedId = this.lifted()?.id;
		// Called only while a row is lifted, which always keeps the order from before.
		const before = this.liftedFrom as PageSection[];
		this.liftedFrom = null;
		this.lifted.set(null);
		const moved =
			before.map((row) => row.id).join() !==
			this.sections()
				.map((row) => row.id)
				.join();
		if (!moved) return;
		this.history.record(before);
		const lifted = this.sections().find((section) => section.id === liftedId);
		this.logStep('pb_log_moved', { name: lifted ? this.sectionName(lifted) : '' });
		this.syncHistory();
		this.scheduleSave(SAVE_DELAY_MS);
	}

	private announce(key: string, params: Record<string, unknown>): void {
		this.announcement.set(this.transloco.translate(key, params));
	}

	private focusRow(id: string): void {
		if (!this.isBrowser) return;
		setTimeout(() => document.querySelector<HTMLElement>(`[data-outline="${id}"]`)?.focus(), 0);
	}

	// ── Saving (FX-23) ─────────────────────────────────────────────────────────────────────────────────────

	private scheduleSave(delay: number): void {
		if (!this.isBrowser || this.readOnly() || this.saveState() === 'conflict') return;
		if (this.saveState() === 'refused') this.saveState.set('saving');
		if (this.saveState() !== 'retrying') this.saveState.set('saving');
		this.keepInTab();
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.save(), delay);
	}

	async save(): Promise<void> {
		this.saveTimer = null;
		const sections = this.sections();
		try {
			const view = await lastValueFrom(
				this.gateway.saveDraft(this.layoutId, { sections, expectedDraftId: this.draftId }),
			);
			this.draftId = view.draft?.id ?? null;
			this.view.set(view);
			this.retryAt = 0;
			// Changes made while the save was on its way save next.
			if (this.sections() !== sections) {
				this.scheduleSave(SAVE_DELAY_MS);
				return;
			}
			this.saveState.set('saved');
			this.forgetInTab();
		} catch (error) {
			const status = (error as { status?: number }).status;
			const body = (error as { error?: { error?: Record<string, unknown> } }).error?.error ?? {};
			if (status === 409) {
				this.saveState.set('conflict');
				this.blocker.set({
					name: (body['savedBy'] as string) ?? null,
					at: (body['savedAt'] as string) ?? null,
				});
				return;
			}
			if (status === 400) {
				// A value the API does not take: say so and wait for the next change, never retry the same one.
				this.saveState.set('refused');
				this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('pb_value_refused'));
				return;
			}
			if (status === 423) {
				this.saveState.set('locked');
				this.blocker.set({
					name: (body['holderName'] as string) ?? null,
					at: (body['since'] as string) ?? null,
				});
				return;
			}
			this.saveState.set('retrying');
			const wait = RETRY_MS[Math.min(this.retryAt, RETRY_MS.length - 1)] as number;
			this.retryAt += 1;
			this.saveTimer = setTimeout(() => void this.save(), wait);
		}
	}

	/** A conflict: open what the other admin saved; this tab's changes stay in the tab until then. */
	reload(): void {
		this.forgetInTab();
		this.saveState.set('saved');
		this.history.record(this.sections());
		this.logStep('pb_log_opened_newer', {});
		void this.load();
	}

	private keepInTab(): void {
		try {
			sessionStorage.setItem(
				unsavedKey(this.layoutId),
				JSON.stringify({ draftId: this.draftId, sections: this.sections() }),
			);
		} catch {
			// Private windows can refuse storage; the save itself still runs.
		}
	}

	private forgetInTab(): void {
		try {
			sessionStorage.removeItem(unsavedKey(this.layoutId));
		} catch {
			// Nothing kept.
		}
	}

	private close(): void {
		if (this.heartbeat) clearInterval(this.heartbeat);
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			void this.save();
		}
		if (this.isBrowser && this.saveState() !== 'locked') {
			this.gateway.unlock(this.layoutId).subscribe({ error: () => undefined });
		}
	}

	choose(id: string): void {
		this.selectedId.set(id);
		this.pane.set('settings');
	}

	// ── History (E3) and Go Live (E1, E2, E5) ───────────────────────────────────────────────────────────

	private logStep(key: string, params: Record<string, unknown>): void {
		this.steps.push({ at: new Date(), key, params });
		if (this.steps.length > 50) this.steps.shift();
		this.undoneSteps = [];
	}

	/** This session's lines, oldest first; repeated edits of one section in a row show as one line. */
	sessionLines(): SessionLine[] {
		const lines: SessionLine[] = [];
		for (const step of this.steps) {
			const last = lines.at(-1);
			if (last && last.key === step.key && JSON.stringify(last.params) === JSON.stringify(step.params)) {
				last.at = step.at;
				last.steps += 1;
			} else lines.push({ ...step, steps: 1 });
		}
		return lines;
	}

	async openHistory(): Promise<void> {
		const ref = this.modals.open(PbHistory, { centered: true, size: 'lg', scrollable: true });
		(ref.componentInstance as PbHistory).start({
			layoutId: this.layoutId,
			pageType: this.pageType,
			locale: this.locale(),
			name: this.view()?.layout.name ?? '',
			session: this.sessionLines(),
			readOnly: this.readOnly(),
		});
		const result = (await ref.result.catch(() => null)) as { bringBack: string } | null;
		if (result?.bringBack) await this.bringBack(result.bringBack);
	}

	/** E3 Bring back: the saved revision becomes the draft (one undo step back to what was here). */
	private async bringBack(revisionId: string): Promise<void> {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			await this.save();
		}
		try {
			const before = this.sections();
			const view = await lastValueFrom(
				this.gateway.bringBack(this.layoutId, { revisionId, expectedDraftId: this.draftId }),
			);
			this.history.record(before);
			this.logStep('pb_log_brought_back', { number: view.draft?.number ?? '' });
			this.view.set(view);
			this.draftId = view.draft?.id ?? null;
			this.sections.set(view.draft?.sections ?? []);
			this.afterBringBack();
			this.toastr.success(this.transloco.translate('pb_brought_back'));
		} catch (error) {
			this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'));
		}
	}

	private afterBringBack(): void {
		if (!this.sections().some((section) => section.id === this.selectedId())) {
			this.selectedId.set(this.sections()[0]?.id ?? null);
		}
		this.syncHistory();
	}

	/** Go Live: saves first, so the checks run on what is on screen, then opens E1/E2 with the answer. */
	async openGoLive(): Promise<void> {
		if (this.saveTimer || this.saveState() === 'saving' || this.saveState() === 'retrying') {
			if (this.saveTimer) clearTimeout(this.saveTimer);
			await this.save();
		}
		if (this.saveState() !== 'saved' && this.saveState() !== 'locked') {
			this.toastr.warning(this.transloco.translate('pb_save_first'));
			return;
		}
		try {
			const view = await lastValueFrom(this.gateway.goLiveView(this.layoutId));
			const ref = this.modals.open(PbGoLive, { centered: true, size: 'lg', scrollable: true });
			const names = Object.fromEntries(this.sections().map((section) => [section.id, this.sectionName(section)]));
			(ref.componentInstance as PbGoLive).start(this.layoutId, view, this.locales, names);
			const outcome = (await ref.result.catch(() => null)) as GoLiveOutcome | null;
			if (outcome) this.afterGoLive(outcome);
		} catch (error) {
			this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'));
		}
	}

	private afterGoLive(outcome: GoLiveOutcome): void {
		switch (outcome.kind) {
			case 'went':
				this.toastr.success(this.transloco.translate('pb_went_' + outcome.state));
				void this.router.navigate(['/page-builder', this.pageType]);
				break;
			case 'reviewed':
				this.toastr.success(this.transloco.translate('pb_review_asked'));
				break;
			case 'moved_on':
				this.saveState.set('conflict');
				break;
			case 'go_to': {
				const problem = outcome.problem;
				if (problem.kind === 'page_settings') {
					void this.router.navigate(['/page-builder', this.pageType, 'settings']);
					return;
				}
				if (problem.locale && this.locales.includes(problem.locale)) this.locale.set(problem.locale);
				if (problem.sectionId) this.choose(problem.sectionId);
				break;
			}
		}
	}

	sectionName(section: PageSection): string {
		return this.transloco.translate('pb_section_' + section.type);
	}
}
