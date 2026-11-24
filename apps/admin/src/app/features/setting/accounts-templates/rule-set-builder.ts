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
import { newKey } from './template-builder';

import type { BusinessKind, TaxRuleEntry, TaxRuleSetContent } from '@saha-textile/contracts';

const ROLE = /^[a-z][a-z0-9_]{1,59}$/;
const today = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Settings › Accounts templates › a tax rule set (accounts templates plan AT5): its entries as the drawn table
 * (service, SAC, rate, expense role, the kinds it applies to, from, source with the CA review tag), the selected entry's
 * details as in the chart builder, Compare with vN, Save draft and Publish vN. Publishing checks that keys are unique,
 * dates make sense, kinds stay within the set's own and every expense role has a ledger in each kind's chart.
 */
@Component({
	selector: 'app-rule-set-builder',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './rule-set-builder.html',
})
export class RuleSetBuilderPage {
	private readonly gateway = inject(AccountsTemplatesGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly code = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('code') ?? '')), {
		initialValue: '',
	});
	readonly canEdit = computed(() => this.auth.permissions().includes('accounts_template.edit'));
	readonly kinds: readonly BusinessKind[] = [
		'proprietorship',
		'partnership',
		'llp',
		'private_limited_opc',
		'private_limited',
	];

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

	readonly content = signal<TaxRuleSetContent | null>(null);
	readonly validFrom = signal(today());
	readonly source = signal('');
	readonly notes = signal('');
	readonly selected = signal<string | null>(null);
	readonly comparing = signal(false);
	readonly dirty = signal(false);
	readonly busy = signal(false);
	readonly problems = signal<string[]>([]);

	/** The newest version (Compare with it) and the one Publish makes. */
	readonly latest = computed(() => this.template.data()?.versions.length ?? 0);
	readonly nextVersion = computed(() => this.latest() + 1);
	readonly entry = computed(() => this.content()?.entries.find((row) => row.key === this.selected()));
	/** Keys the newest version already has: they stay as they are (self-invoices keep the rule by key). */
	private readonly published = computed(() => {
		const versions = this.template.data()?.versions ?? [];
		const latest = versions[versions.length - 1]?.content;
		return new Set(latest?.kind === 'taxRules' ? latest.entries.map((row) => row.key) : []);
	});

	constructor() {
		effect(() => {
			const template = this.template.data();
			if (!template) return;
			untracked(() => {
				const versions = template.versions;
				const start = template.draft?.content ?? versions[versions.length - 1]?.content ?? null;
				this.content.set(start?.kind === 'taxRules' ? start : null);
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

	/** "All" or the kinds an entry is for. */
	appliesTo(entry: TaxRuleEntry): string {
		if (entry.kinds === null) return this.transloco.translate('rs_all');
		return entry.kinds.map((kind) => this.transloco.translate(`co_kind_${kind}`)).join(', ');
	}

	private edit(change: (entries: TaxRuleEntry[]) => TaxRuleEntry[]): void {
		this.content.update((content) => (content ? { ...content, entries: change(content.entries) } : content));
		this.dirty.set(true);
	}

	addEntry(): void {
		const name = this.transloco.translate('rs_new_entry');
		const key = newKey(name, new Set(this.content()?.entries.map((row) => row.key)));
		this.edit((entries) => [
			...entries,
			{
				key,
				name,
				code: '',
				ratePercent: 0,
				expenseRole: null,
				kinds: null,
				from: this.validFrom(),
				to: null,
				source: '',
				caReview: 'pending',
			},
		]);
		this.selected.set(key);
	}

	patch(key: string, change: Partial<TaxRuleEntry>): void {
		this.edit((entries) => entries.map((row) => (row.key === key ? { ...row, ...change } : row)));
		this.selected.set(change.key ?? key);
	}

	/** An expense role typed as a key ("legal_fees"); anything else clears it. */
	role(key: string, text: string): void {
		const role = text.trim();
		this.patch(key, { expenseRole: ROLE.test(role) ? role : null });
	}

	/** "All kinds", or each kind ticked on its own (starting from every kind when "All" is unticked). */
	allKinds(key: string, all: boolean): void {
		this.patch(key, { kinds: all ? null : [...this.kinds] });
	}

	toggleKind(entry: TaxRuleEntry, kind: BusinessKind, on: boolean): void {
		const kinds = (entry.kinds ?? []).filter((each) => each !== kind);
		this.patch(entry.key, {
			kinds: on ? this.kinds.filter((each) => each === kind || kinds.includes(each)) : kinds,
		});
	}

	remove(key: string): void {
		this.edit((entries) => entries.filter((row) => row.key !== key));
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
