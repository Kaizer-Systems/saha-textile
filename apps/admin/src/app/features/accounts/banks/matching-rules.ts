import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { BANK_KEYS, BanksGateway } from '@core/accounts/banks.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { statementProblem } from './statement-import';

import type { MatchRule, MatchRuleWrite, MatchThen } from '@saha-textile/contracts';

/** What a rule of words can do (BA10 Add rule). */
export const WORD_THENS: readonly MatchThen[] = ['bank_charge', 'interest', 'leave'];

const writeOf = (rule: MatchRule): MatchRuleWrite => ({
	id: rule.id,
	when: rule.when,
	words: rule.words,
	onlyIn: rule.onlyIn,
	then: rule.then,
	gstPercent: rule.gstPercent,
	on: rule.on,
});

/**
 * Matching rules (accounts brief BA10): how statement lines are matched to the books or turned into entries, in the
 * order they are tried. The app's own rules can be switched off and their words changed; rules of words can be added.
 * Anything no rule finds is left for a person.
 */
@Component({
	selector: 'app-matching-rules',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './matching-rules.html',
})
export class MatchingRulesPage {
	private readonly gateway = inject(BanksGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly thens = WORD_THENS;
	readonly rules = injectQuery(() => ({
		queryKey: BANK_KEYS.rules,
		queryFn: () => firstValueFrom(this.gateway.rules()),
	}));
	/** The rule in the form above the table, when one is being added or changed. */
	readonly editing = signal<MatchRuleWrite | null>(null);
	readonly wordsText = signal('');
	readonly busy = signal(false);

	whenText(rule: MatchRule): string {
		if (rule.when !== 'words') return this.transloco.translate(`bank_rule_when_${rule.when}`);
		const words = rule.words.map((w) => `"${w}"`).join(', ');
		return this.transloco.translate(rule.onlyIn ? 'bank_rule_when_words_in' : 'bank_rule_when_words', { words });
	}

	thenText(rule: MatchRule): string {
		return this.transloco.translate(`bank_rule_then_${rule.then}`, { rate: rule.gstPercent ?? 0 });
	}

	resultText(rule: MatchRule): string {
		if (rule.when === 'amount_party') return this.transloco.translate('bank_rule_result_party');
		if (rule.when !== 'words')
			return this.transloco.translate(
				rule.then === 'match' ? 'bank_rule_result_sure' : 'bank_rule_result_unsure',
			);
		return this.transloco.translate(rule.then === 'leave' ? 'bank_rule_result_none' : 'bank_rule_result_rule');
	}

	add(): void {
		this.editing.set({
			id: null,
			when: 'words',
			words: [],
			onlyIn: false,
			then: 'bank_charge',
			gstPercent: 18,
			on: true,
		});
		this.wordsText.set('');
	}

	edit(rule: MatchRule): void {
		this.editing.set(writeOf(rule));
		this.wordsText.set(rule.words.join(', '));
	}

	set<K extends keyof MatchRuleWrite>(field: K, value: MatchRuleWrite[K]): void {
		this.editing.update((rule) => (rule ? { ...rule, [field]: value } : rule));
	}

	cancel(): void {
		this.editing.set(null);
	}

	async save(): Promise<void> {
		const rule = this.editing();
		if (!rule) return;
		const words = this.wordsText()
			.split(',')
			.map((w) => w.trim())
			.filter(Boolean);
		if (await this.saveRule({ ...rule, words, gstPercent: rule.then === 'bank_charge' ? rule.gstPercent : null }))
			this.editing.set(null);
	}

	toggle(rule: MatchRule): Promise<boolean> {
		return this.saveRule({ ...writeOf(rule), on: !rule.on });
	}

	private async saveRule(write: MatchRuleWrite): Promise<boolean> {
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.saveRule(write));
			this.notifier.showSuccess(this.transloco.translate('bank_rule_saved'));
			await this.queries.invalidateQueries({ queryKey: BANK_KEYS.rules });
			return true;
		} catch (error) {
			const problem = statementProblem(apiProblem(error, 'failed'));
			this.notifier.showError(this.transloco.translate(problem.key, problem.params));
			return false;
		} finally {
			this.busy.set(false);
		}
	}
}
