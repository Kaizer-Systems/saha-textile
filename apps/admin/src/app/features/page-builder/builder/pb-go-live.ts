import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { languageName } from '@saha-textile/core-domain/languages';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { lastValueFrom } from 'rxjs';

import { istInputToUtc } from '@core/i18n/ist-time';
import {
	type AdminBuilderPage,
	type GoLiveBudgetLine,
	type GoLiveView,
	type LayoutProblemView,
	PageBuilderGateway,
} from '@core/page-builder/page-builder.gateway';
import { PluralPipe, translateCount } from '@shared/pipes/language.pipes';

/** What the popup answers: went (live, scheduled or waiting), a problem to go to, or a review asked. */
export type GoLiveOutcome =
	| { kind: 'went'; state: 'live' | 'scheduled' | 'waiting'; page: AdminBuilderPage }
	| { kind: 'go_to'; problem: LayoutProblemView }
	| { kind: 'reviewed' }
	| { kind: 'moved_on' };

/** Problems that belong to a language (words and the page's search settings), by language. */
const WORDS = new Set(['words', 'page_settings']);
/** Problems about pictures (E1's second and third lines). */
const PICTURES = new Set(['picture_missing', 'picture_not_ready', 'shape']);

/**
 * Go Live (brief E1, E2, E5, P6): what will change on the shop (SG-16), every check with "Go to it", the speed
 * budget (SG-9), then now or at an India time, ending when another layout goes live or at a time and handing back
 * (E2). With only a picture still being made in the way, it offers to go live by itself once it is ready (E5).
 * Admins who may not go live ask for review instead (SG-18).
 */
@Component({
	selector: 'app-pb-go-live',
	templateUrl: './pb-go-live.html',
	imports: [DatePipe, PluralPipe, TranslocoModule],
})
export class PbGoLive {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(PageBuilderGateway);
	private readonly transloco = inject(TranslocoService);

	readonly view = signal<GoLiveView | null>(null);
	readonly locales = signal<string[]>([]);
	readonly sectionNames = signal<Record<string, string>>({});
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	readonly compare = signal(false);
	/** E5: the step shown when only pictures still being made hold it. */
	readonly asking = signal(false);

	readonly when = signal<'now' | 'at'>('now');
	readonly fromLocal = signal('');
	readonly ends = signal<'another' | 'at'>('another');
	readonly untilLocal = signal('');
	readonly handBackTo = signal<string | null>(null);
	readonly note = signal('');

	private layoutId = '';

	start(layoutId: string, view: GoLiveView, locales: readonly string[], sectionNames: Record<string, string>): void {
		this.layoutId = layoutId;
		this.view.set(view);
		this.locales.set([...locales]);
		this.sectionNames.set(sectionNames);
		this.handBackTo.set(view.naturalHandBack ?? view.handBackTo[0]?.layoutId ?? null);
	}

	readonly problems = computed(() => this.view()?.problems ?? []);

	/** E1's language lines: each shop language, with what it still lacks. */
	readonly languageLines = computed(() =>
		this.locales().map((locale) => ({
			locale,
			language: languageName(locale),
			todo: this.problems().filter((problem) => WORDS.has(problem.kind) && problem.locale === locale),
		})),
	);
	readonly pictureProblems = computed(() => this.problems().filter((problem) => PICTURES.has(problem.kind)));
	readonly phoneProblems = computed(() => this.problems().filter((problem) => problem.kind === 'phone_picture'));
	readonly linkProblems = computed(() => this.problems().filter((problem) => problem.kind === 'link_gone'));
	/** SG-1: lines of words over a picture that don't reach AA, per screen band. */
	readonly wordProblems = computed(() => this.problems().filter((problem) => problem.kind === 'words_unreadable'));
	readonly budgetProblems = computed(() => this.problems().filter((problem) => problem.kind === 'budget'));
	/** Sections the page type does not take, repeated ids, an empty layout. */
	readonly layoutProblems = computed(() =>
		this.problems().filter((problem) => ['empty', 'not_allowed', 'duplicate_id'].includes(problem.kind)),
	);

	readonly fromIso = computed(() => (this.when() === 'at' ? istInputToUtc(this.fromLocal()) : null));
	readonly untilIso = computed(() => (this.ends() === 'at' ? istInputToUtc(this.untilLocal()) : null));
	/** The times make sense: a start when "at", an end after the start when "at". */
	readonly timesReady = computed(() => {
		if (this.when() === 'at' && !this.fromIso()) return false;
		if (this.ends() === 'at') {
			const until = this.untilIso();
			if (!until) return false;
			const from = this.fromIso() ?? new Date().toISOString();
			if (until <= from) return false;
		}
		return true;
	});
	readonly canGo = computed(() => !!this.view()?.canGoLive && this.problems().length === 0 && this.timesReady());
	readonly handBackName = computed(
		() => this.view()?.handBackTo.find((row) => row.layoutId === this.handBackTo())?.name ?? null,
	);

	/** SG-16's one line: how many sections are added, moved, changed, removed or hidden, and how many new pictures. */
	readonly changesLine = computed(() => {
		const changes = this.view()?.changes;
		if (!changes) return '';
		if (changes.firstTime) return this.transloco.translate('pb_changes_first');
		const parts: string[] = [];
		for (const kind of ['added', 'moved', 'changed', 'removed', 'hidden', 'shown'] as const) {
			const count = changes.list.filter((change) => change.kind === kind).length;
			if (count) parts.push(translateCount(this.transloco, `pb_changes_${kind}`, count));
		}
		if (changes.newPictures) parts.push(translateCount(this.transloco, 'pb_changes_pictures', changes.newPictures));
		return parts.length ? parts.join(', ') : this.transloco.translate('pb_changes_none');
	});

	readonly Math = Math;

	/** A budget line's figure: "1 of 1", "3.9 of 10 KB", or code that loads later. */
	budgetText(line: GoLiveBudgetLine): string {
		if (line.limit === null) return this.transloco.translate('pb_budget_later', { value: line.value });
		if (line.key === 'early_pictures') {
			return this.transloco.translate('pb_budget_of_count', { value: line.value, limit: line.limit });
		}
		const unit = this.transloco.translate('pb_unit_' + line.key);
		return this.transloco.translate('pb_budget_of', { value: line.value, limit: line.limit, unit });
	}

	/** A word field's label: a section's title, or a picture's alt text, heading, subheading or button label. */
	fieldName(field: string | undefined): string {
		return this.transloco.translate(field === 'title' ? 'pb_field_title' : `banner_${field ?? ''}`);
	}

	sectionName(id: string | undefined, type?: string): string {
		return (id && this.sectionNames()[id]) || (type ? this.transloco.translate('pb_section_' + type) : (id ?? ''));
	}

	/** One problem in words: where it is (section · piece · picture) and what is missing. */
	where(problem: LayoutProblemView): string {
		const parts = [this.sectionName(problem.sectionId, problem.type)];
		if (problem.piece) parts.push(this.transloco.translate('pb_piece_' + problem.piece));
		if (problem.picture !== undefined)
			parts.push(this.transloco.translate('pb_picture_n', { n: problem.picture + 1 }));
		return parts.filter(Boolean).join(' · ');
	}

	/** One unreadable line: where, on which screens, how well it reads, and the fixes that pass on that picture. */
	wordsLine(problem: LayoutProblemView): string {
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		const line = t('pb_words_line', {
			where: this.where(problem),
			band: t('pb_band_' + (problem.band ?? 'desktop')),
			field: this.fieldName(problem.field),
			ratio: problem.ratio,
			needed: problem.needed,
		});
		const fixes = (problem.fixes ?? []).map((fix) =>
			t('pb_fix_item', {
				ink: t('pb_ink_' + fix.ink),
				backing: t('pb_backing_' + fix.backing),
				ratio: fix.ratio,
			}),
		);
		return fixes.length
			? `${line} ${t('pb_words_fixes', { fixes: fixes.join('; ') })}`
			: `${line} ${t('pb_words_no_fix')}`;
	}

	goTo(problem: LayoutProblemView): void {
		this.modal.close({ kind: 'go_to', problem } satisfies GoLiveOutcome);
	}

	/** Go Live or Schedule; with pictures still being made, first asks E5's question. */
	async go(whenReady = false): Promise<void> {
		const view = this.view();
		if (!view?.draftRevisionId || !this.canGo()) return;
		if (view.waitingPictures > 0 && !whenReady) {
			this.asking.set(true);
			return;
		}
		this.busy.set(true);
		this.error.set(null);
		try {
			const answer = await lastValueFrom(
				this.gateway.goLive(this.layoutId, {
					expectedDraftId: view.draftRevisionId,
					from: this.fromIso(),
					until: this.untilIso(),
					handBackTo: this.ends() === 'at' ? this.handBackTo() : null,
					whenReady,
				}),
			);
			this.modal.close({ kind: 'went', state: answer.state, page: answer.page } satisfies GoLiveOutcome);
		} catch (error) {
			const status = (error as { status?: number }).status;
			if (status === 409) {
				this.modal.close({ kind: 'moved_on' } satisfies GoLiveOutcome);
				return;
			}
			// Something changed meanwhile (a link went off the shop): show the checks again.
			if (status === 400) await this.refresh();
			this.error.set(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'));
		} finally {
			this.busy.set(false);
			this.asking.set(false);
		}
	}

	async askReview(): Promise<void> {
		this.busy.set(true);
		try {
			await lastValueFrom(this.gateway.askReview(this.layoutId, this.note().trim()));
			this.modal.close({ kind: 'reviewed' } satisfies GoLiveOutcome);
		} catch (error) {
			this.error.set(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'));
		} finally {
			this.busy.set(false);
		}
	}

	private async refresh(): Promise<void> {
		this.view.set(await lastValueFrom(this.gateway.goLiveView(this.layoutId)).catch(() => this.view()));
	}
}
