import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { ACCOUNTS_TEMPLATE_KEYS, AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { apiIssues } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { templateWords } from './accounts-templates-page';

import type {
	AccountNature,
	ChartTemplateContent,
	ChartTemplateGroup,
	ChartTemplateLedger,
} from '@saha-textile/contracts';

export interface BuilderNode {
	group: ChartTemplateGroup;
	groups: BuilderNode[];
	ledgers: ChartTemplateLedger[];
}

/** The draft's groups as a tree, each with its ledgers (groups whose parent is missing sit at the top). */
export function builderTree(content: ChartTemplateContent): BuilderNode[] {
	const keys = new Set(content.groups.map((g) => g.key));
	const build = (parent: string | null): BuilderNode[] =>
		content.groups
			.filter((g) => (parent === null ? g.parentKey === null || !keys.has(g.parentKey) : g.parentKey === parent))
			.map((group) => ({
				group,
				groups: build(group.key),
				ledgers: content.ledgers.filter((l) => l.groupKey === group.key),
			}));
	return build(null);
}

/** A key for a new item: the name in lower case with underscores, made unique. */
export function newKey(name: string, taken: ReadonlySet<string>): string {
	const base = `x_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`.replace(/^x_(?=[a-z])/, '').replace(/_+$/, '');
	let key = base.slice(0, 50);
	for (let n = 2; taken.has(key); n += 1) key = `${base.slice(0, 50)}_${n}`;
	return key;
}

const ROLE = /^[a-z][a-z0-9_]{1,59}$/;
const today = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Settings › Accounts templates › a chart template (accounts templates plan AT3): its groups and ledgers as a tree, the
 * selected one's details, Save draft and Publish vN. Publishing checks that the chart is whole for every kind it
 * applies to, that every role a document needs has a ledger and that no role is played twice; each problem is listed.
 * Tax rule sets and reports are read here; their builders come with T5 and T6.
 */
@Component({
	selector: 'app-template-builder',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, NgTemplateOutlet],
	templateUrl: './template-builder.html',
})
export class TemplateBuilderPage {
	private readonly gateway = inject(AccountsTemplatesGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly code = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('code') ?? '')), {
		initialValue: '',
	});
	readonly canEdit = computed(() => this.auth.permissions().includes('accounts_template.edit'));
	readonly natures: readonly AccountNature[] = ['asset', 'liability', 'equity', 'income', 'expense'];

	readonly template = injectQuery(() => ({
		queryKey: ACCOUNTS_TEMPLATE_KEYS.one(this.code()),
		queryFn: () => firstValueFrom(this.gateway.get(this.code())),
		enabled: !!this.code(),
	}));
	readonly changes = injectQuery(() => ({
		queryKey: ACCOUNTS_TEMPLATE_KEYS.changes(this.code()),
		queryFn: () => firstValueFrom(this.gateway.changes(this.code())),
		enabled: !!this.code(),
	}));
	readonly library = injectQuery(() => ({
		queryKey: ACCOUNTS_TEMPLATE_KEYS.library,
		queryFn: () => firstValueFrom(this.gateway.library()),
	}));

	readonly content = signal<ChartTemplateContent | null>(null);
	readonly validFrom = signal(today());
	readonly source = signal('');
	readonly notes = signal('');
	readonly selected = signal<{ kind: 'group' | 'ledger'; key: string } | null>(null);
	readonly dirty = signal(false);
	readonly busy = signal(false);
	readonly problems = signal<string[]>([]);

	/** The version Publish makes. */
	readonly nextVersion = computed(() => (this.template.data()?.versions.length ?? 0) + 1);
	readonly tree = computed(() => {
		const content = this.content();
		return content ? builderTree(content) : [];
	});
	readonly ruleSets = computed(() => (this.library.data() ?? []).filter((row) => row.kind === 'taxRules'));
	/** Keys the newest version already has: their keys stay as they are (the books link by key). */
	private readonly published = computed(() => {
		const versions = this.template.data()?.versions ?? [];
		const latest = versions[versions.length - 1]?.content;
		return new Set(latest?.kind === 'chart' ? [...latest.groups, ...latest.ledgers].map((i) => i.key) : []);
	});

	constructor() {
		effect(() => {
			const template = this.template.data();
			if (!template) return;
			untracked(() => {
				const versions = template.versions;
				const start = template.draft?.content ?? versions[versions.length - 1]?.content ?? null;
				this.content.set(start?.kind === 'chart' ? start : null);
				this.validFrom.set(template.draft?.validFrom ?? today());
				this.source.set(template.draft?.source ?? '');
				this.notes.set(template.draft?.notes ?? '');
				this.dirty.set(false);
			});
		});
	}

	readonly group = computed(() => {
		const pick = this.selected();
		return pick?.kind === 'group' ? this.content()?.groups.find((g) => g.key === pick.key) : undefined;
	});
	readonly ledger = computed(() => {
		const pick = this.selected();
		return pick?.kind === 'ledger' ? this.content()?.ledgers.find((l) => l.key === pick.key) : undefined;
	});

	isNew(key: string): boolean {
		return !this.published().has(key);
	}

	private edit(change: (content: ChartTemplateContent) => ChartTemplateContent): void {
		this.content.update((content) => (content ? change(content) : content));
		this.dirty.set(true);
	}

	private taken(): Set<string> {
		const content = this.content();
		return new Set([...(content?.groups ?? []), ...(content?.ledgers ?? [])].map((i) => i.key));
	}

	addGroup(parentKey: string | null): void {
		const key = newKey(this.transloco.translate('tb_new_group'), this.taken());
		const parent = this.content()?.groups.find((g) => g.key === parentKey);
		this.edit((c) => ({
			...c,
			groups: [
				...c.groups,
				{ key, name: key, parentKey, nature: parent?.nature ?? 'expense', tradingAccount: false, roles: [] },
			],
		}));
		this.selected.set({ kind: 'group', key });
	}

	addLedger(groupKey: string): void {
		const key = newKey(this.transloco.translate('tb_new_ledger'), this.taken());
		this.edit((c) => ({
			...c,
			ledgers: [
				...c.ledgers,
				{ key, name: key, groupKey, handPosting: true, roles: [], ruleSetCode: null, source: '' },
			],
		}));
		this.selected.set({ kind: 'ledger', key });
	}

	patchGroup(key: string, change: Partial<ChartTemplateGroup>): void {
		// A group's new key carries its child groups and ledgers with it.
		const to = change.key ?? key;
		this.edit((c) => ({
			...c,
			groups: c.groups.map((g) =>
				g.key === key ? { ...g, ...change } : g.parentKey === key ? { ...g, parentKey: to } : g,
			),
			ledgers: c.ledgers.map((l) => (l.groupKey === key ? { ...l, groupKey: to } : l)),
		}));
		this.selected.set({ kind: 'group', key: to });
	}

	patchLedger(key: string, change: Partial<ChartTemplateLedger>): void {
		this.edit((c) => ({ ...c, ledgers: c.ledgers.map((l) => (l.key === key ? { ...l, ...change } : l)) }));
		this.selected.set({ kind: 'ledger', key: change.key ?? key });
	}

	/** Roles typed as "cash, bank_charges": only well-formed keys are kept. */
	roles(text: string): string[] {
		return text
			.split(',')
			.map((role) => role.trim())
			.filter((role) => ROLE.test(role));
	}

	remove(kind: 'group' | 'ledger', key: string): void {
		this.edit((c) =>
			kind === 'ledger'
				? { ...c, ledgers: c.ledgers.filter((l) => l.key !== key) }
				: { ...c, groups: c.groups.filter((g) => g.key !== key) },
		);
		this.selected.set(null);
	}

	private async refresh(): Promise<void> {
		await this.queryClient.invalidateQueries({ queryKey: ['accounts-templates'] });
	}

	private say(error: unknown): string[] {
		const t = (key: string) => this.transloco.translate(key);
		const codes = apiIssues(error).map((issue) => issue.message);
		return codes.length ? codes.map((code) => templateWords(code, t)) : [t('at_action_failed')];
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
			this.notifier.showSuccess(
				this.transloco.translate('tb_published', { version: String(this.nextVersion()) }),
			);
		} catch (error) {
			this.problems.set(this.say(error));
		} finally {
			this.busy.set(false);
		}
	}
}
