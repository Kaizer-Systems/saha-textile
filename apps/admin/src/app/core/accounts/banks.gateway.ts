import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	BankAccount,
	BankAccountList,
	BankAccountRow,
	BankAccountWrite,
	BankImport,
	BankLayout,
	BankLayoutWrite,
	BankLine,
	BankLinePage,
	BankLineQuery,
	BookEntry,
	IfscLookup,
	MatchRule,
	MatchRuleWrite,
	ReconcilePeriod,
	ReconcileQuery,
	ReconcileView,
	StatementPreview,
	StatementPreviewWrite,
	StatementSaveWrite,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const BANK_KEYS = {
	all: ['banks'] as const,
	list: ['banks', 'list'] as const,
	one: (id: string) => ['banks', 'one', id] as const,
	layouts: ['banks', 'layouts'] as const,
	lines: (id: string, query: Partial<BankLineQuery>) => ['banks', 'lines', id, query] as const,
	reconcile: (id: string, query: ReconcileQuery) => ['banks', 'reconcile', id, query] as const,
	entries: (id: string, q: string) => ['banks', 'entries', id, q] as const,
	rules: ['banks', 'rules'] as const,
};

/** The admin repeats the contract's chips (a spec holds them equal). */
export const BANK_CHIPS = ['all', 'current', 'credit', 'deposits'] as const;

/** Bank accounts (accounts brief BA1–BA3). */
@Injectable({ providedIn: 'root' })
export class BanksGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path = '') => `${runtimeConfig.apiUrl}/admin/accounts/banks${path}`;

	list(): Observable<BankAccountList> {
		return this.http.get<BankAccountList>(this.api());
	}

	one(id: string): Observable<BankAccountRow> {
		return this.http.get<BankAccountRow>(this.api(`/${encodeURIComponent(id)}`));
	}

	ifsc(code: string): Observable<IfscLookup> {
		return this.http.get<IfscLookup>(this.api('/ifsc'), { params: { code } });
	}

	add(write: BankAccountWrite): Observable<BankAccount> {
		return this.http.post<BankAccount>(this.api(), write);
	}

	edit(id: string, write: BankAccountWrite & { version: number }): Observable<BankAccount> {
		return this.http.put<BankAccount>(this.api(`/${encodeURIComponent(id)}`), write);
	}

	layouts(): Observable<BankLayout[]> {
		return this.http.get<BankLayout[]>(this.api('/layouts'));
	}

	saveLayout(write: BankLayoutWrite): Observable<BankLayout> {
		return this.http.put<BankLayout>(this.api('/layouts'), write);
	}

	preview(id: string, write: StatementPreviewWrite): Observable<StatementPreview> {
		return this.http.post<StatementPreview>(this.api(`/${encodeURIComponent(id)}/lines/preview`), write);
	}

	saveLines(id: string, write: StatementSaveWrite): Observable<BankImport> {
		return this.http.post<BankImport>(this.api(`/${encodeURIComponent(id)}/lines`), write);
	}

	lines(id: string, query: Partial<BankLineQuery>): Observable<BankLinePage> {
		return this.http.get<BankLinePage>(this.api(`/${encodeURIComponent(id)}/lines`), { params: { ...query } });
	}

	reconcile(id: string, query: ReconcileQuery): Observable<ReconcileView> {
		return this.http.get<ReconcileView>(this.api(`/${encodeURIComponent(id)}/reconcile`), { params: { ...query } });
	}

	acceptSure(id: string, period: ReconcilePeriod): Observable<{ accepted: number }> {
		return this.http.post<{ accepted: number }>(
			this.api(`/${encodeURIComponent(id)}/reconcile/accept-sure`),
			period,
		);
	}

	accept(id: string, lineId: string, period: ReconcilePeriod): Observable<BankLine> {
		return this.http.post<BankLine>(this.line(id, lineId, 'accept'), period);
	}

	reject(id: string, lineId: string, period: ReconcilePeriod): Observable<BankLine> {
		return this.http.post<BankLine>(this.line(id, lineId, 'reject'), period);
	}

	link(id: string, lineId: string, voucherIds: readonly string[]): Observable<BankLine> {
		return this.http.post<BankLine>(this.line(id, lineId, 'link'), { voucherIds });
	}

	unmatch(id: string, lineId: string): Observable<BankLine> {
		return this.http.post<BankLine>(this.line(id, lineId, 'unmatch'), {});
	}

	entries(id: string, q: string): Observable<BookEntry[]> {
		return this.http.get<BookEntry[]>(this.api(`/${encodeURIComponent(id)}/reconcile/entries`), { params: { q } });
	}

	rules(): Observable<MatchRule[]> {
		return this.http.get<MatchRule[]>(this.api('/matching-rules'));
	}

	saveRule(write: MatchRuleWrite): Observable<MatchRule> {
		return this.http.put<MatchRule>(this.api('/matching-rules'), write);
	}

	private line(id: string, lineId: string, action: string): string {
		return this.api(`/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}/${action}`);
	}
}
