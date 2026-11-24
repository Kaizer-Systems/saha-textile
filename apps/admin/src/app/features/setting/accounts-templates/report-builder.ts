import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { ACCOUNTS_TEMPLATE_KEYS, AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { apiIssues, shortDate } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { templateWords } from './accounts-templates-page';
import { newKey } from './template-builder';
import { rupees } from '../../accounts/ledger-helpers';

import type { ReportLine, ReportPreview, ReportSource, ReportTemplateContent } from '@saha-textile/contracts';

export interface ReportNode {
	line: ReportLine;
	lines: ReportNode[];
}

/** The report's lines as a tree (a line whose parent is missing sits at the top; a loop is left out). */
export function reportTree(lines: readonly ReportLine[]): ReportNode[] {
	const keys = new Set(lines.map((line) => line.key));
	const seen = new Set<string>();
	const build = (parent: string | null): ReportNode[] =>
		lines
			.filter((line) =>
				parent === null ? line.parentKey === null || !keys.has(line.parentKey) : line.parentKey === parent,
			)
			.filter((line) => !seen.has(line.key) && seen.add(line.key))
			.map((line) => ({ line, lines: build(line.key) }));
	return build(null);
}

const KEY = /^[a-z][a-z0-9_]{1,59}$/;
const KINDS: readonly ReportSource['kind'][] = ['role', 'group', 'ledger'];
const today = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Settings › Accounts templates › a report template (accounts templates plan AT6): its lines as a tree, each with what
 * it adds up ("= roles: …"), the drawn settings (applies to, columns, a note per line, the level), the selected line's
 * details as in the chart builder, Preview with this company, Save draft and Publish. Publishing checks that keys are
 * unique, parents exist, no line sits under itself and every source is in the chart of each kind it applies to.
 */
@Component({
	selector: 'app-report-builder',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, NgTemplateOutlet],
	templateUrl: './report-builder.html',
})
export class ReportBuilderPage {
	private readonly gateway = inject(AccountsTemplatesGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly code = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('code') ?? '')), {
		initialValue: '',
	});
	readonly canEdit = computed(() => this.auth.permissions().includes('accounts_template.edit'));
	readonly kinds = KINDS;
	readonly levels: readonly NonNullable<ReportTemplateContent['level']>[] = ['auto', 'I', 'II', 'III', 'IV'];
	readonly rupees = rupees;
	readonly day = shortDate;

	readonly template = injectQuery(() => ({
		queryKey: ACCOUNTS_TEMPLATE_KEYS.one(this.code()),
		queryFn: () => firstValueFrom(this.gateway.get(this.code())),
		enabled: !!this.code(),
	}));

	readonly content = signal<ReportTemplateContent | null>(null);
	readonly validFrom = signal(today());
	readonly source = signal('');
	readonly notes = signal('');
	readonly selected = signal<string | null>(null);
	readonly dirty = signal(false);
	readonly busy = signal(false);
	readonly problems = signal<string[]>([]);
	readonly asAt = signal(today());
	readonly preview = signal<ReportPreview | null>(null);

	readonly tree = computed(() => reportTree(this.content()?.lines ?? []));
	readonly line = computed(() => this.content()?.lines.find((row) => row.key === this.selected()));
	/** Lines the selected one may sit under: any other line. */
	readonly parents = computed(() => (this.content()?.lines ?? []).filter((row) => row.key !== this.selected()));
	/** "All kinds" or the kinds the template is for. */
	readonly appliesTo = computed(() => {
		const applies = this.template.data()?.appliesTo;
		if (!applies || applies.all) return this.transloco.translate('at_all_kinds');
		return applies.kinds.map((kind) => this.transloco.translate(`co_kind_${kind}`)).join(', ');
	});
	/** Keys the newest version already has: they stay as they are. */
	private readonly published = computed(() => {
		const versions = this.template.data()?.versions ?? [];
		const latest = versions[versions.length - 1]?.content;
		return new Set(latest?.kind === 'report' ? latest.lines.map((row) => row.key) : []);
	});

	constructor() {
		effect(() => {
			const template = this.template.data();
			if (!template) return;
			untracked(() => {
				const versions = template.versions;
				const start = template.draft?.content ?? versions[versions.length - 1]?.content ?? null;
				this.content.set(start?.kind === 'report' ? start : null);
				this.validFrom.set(template.draft?.validFrom ?? today());
				this.source.set(template.draft?.source ?? '');
				this.notes.set(template.draft?.notes ?? '');
				this.dirty.set(false);
			});
		});
	}

	isNew(key: string): boolean {
		return !this.published().has(key);
	}

	/** AT6's line caption: "roles: owners_capital, drawings · groups: sundry_creditors". */
	sourcesText(line: ReportLine): string {
		return KINDS.flatMap((kind) => {
			const keys = line.sources.filter((source) => source.kind === kind).map((source) => source.key);
			return keys.length ? [`${this.transloco.translate(`rb_caption_${kind}`)}: ${keys.join(', ')}`] : [];
		}).join(' · ');
	}

	/** One kind of source as typed in its box ("cash, bank"). */
	keysOf(line: ReportLine, kind: ReportSource['kind']): string {
		return line.sources
			.filter((source) => source.kind === kind)
			.map((source) => source.key)
			.join(', ');
	}

	private edit(change: (content: ReportTemplateContent) => ReportTemplateContent): void {
		this.content.update((content) => (content ? change(content) : content));
		this.dirty.set(true);
	}

	setting(change: Partial<Pick<ReportTemplateContent, 'columns' | 'notes' | 'level'>>): void {
		this.edit((content) => ({ ...content, ...change }));
	}

	addLine(parentKey: string | null): void {
		const label = this.transloco.translate('rb_new_line');
		const key = newKey(label, new Set(this.content()?.lines.map((row) => row.key)));
		this.edit((content) => ({ ...content, lines: [...content.lines, { key, label, parentKey, sources: [] }] }));
		this.selected.set(key);
	}

	patchLine(key: string, change: Partial<ReportLine>): void {
		// A line's new key carries the lines under it.
		const to = change.key ?? key;
		this.edit((content) => ({
			...content,
			lines: content.lines.map((row) =>
				row.key === key ? { ...row, ...change } : row.parentKey === key ? { ...row, parentKey: to } : row,
			),
		}));
		this.selected.set(to);
	}

	/** A kind of source typed as "cash, bank_accounts": only well-formed keys are kept. */
	setSources(line: ReportLine, kind: ReportSource['kind'], text: string): void {
		const keys = text
			.split(',')
			.map((key) => key.trim())
			.filter((key) => KEY.test(key));
		const others = line.sources.filter((source) => source.kind !== kind);
		this.patchLine(line.key, { sources: [...others, ...keys.map((key) => ({ kind, key }))] });
	}

	remove(key: string): void {
		this.edit((content) => ({ ...content, lines: content.lines.filter((row) => row.key !== key) }));
		this.selected.set(null);
	}

	/** Words for a source the books don't have (`report_source_unknown:<kind>:<key>`). */
	missing(problem: string): string {
		const [, kind, key] = problem.split(':');
		return this.transloco.translate('rb_unknown_source', {
			kind: this.transloco.translate(`rb_source_${kind}`),
			key,
		});
	}

	private async refresh(): Promise<void> {
		await this.queryClient.invalidateQueries({ queryKey: ['accounts-templates'] });
	}

	private say(error: unknown): string[] {
		const t = (key: string) => this.transloco.translate(key);
		const codes = apiIssues(error).map((issue) => issue.message);
		return codes.length ? codes.map((code) => templateWords(code, t)) : [t('at_action_failed')];
	}

	async show(): Promise<void> {
		const template = this.template.data();
		if (!template || this.dirty()) return;
		this.busy.set(true);
		try {
			this.preview.set(await firstValueFrom(this.gateway.preview(template.code, this.asAt() || null)));
			this.problems.set([]);
		} catch (error) {
			this.problems.set(this.say(error));
		} finally {
			this.busy.set(false);
		}
	}

	async saveDraft(): Promise<void> {
		const template = this.template.data();
		const content = this.content();
		if (!template || !content) return;
		this.busy.set(true);
		try {
			await firstValueFrom(
				this.gateway.saveDraft(template.code, {
					content,
					validFrom: this.validFrom(),
					source: this.source(),
					notes: this.notes(),
					expectedUpdatedAt: template.updatedAt,
				}),
			);
			this.problems.set([]);
			this.dirty.set(false);
			await this.refresh();
			this.notifier.showSuccess(this.transloco.translate('tb_saved'));
		} catch (error) {
			this.problems.set(this.say(error));
		} finally {
			this.busy.set(false);
		}
	}

	async publish(): Promise<void> {
		const template = this.template.data();
		if (!template || this.dirty()) return;
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.publish(template.code, template.updatedAt));
			this.problems.set([]);
			await this.refresh();
			this.notifier.showSuccess(this.transloco.translate('rb_published'));
		} catch (error) {
			this.problems.set(this.say(error));
		} finally {
			this.busy.set(false);
		}
	}
}
