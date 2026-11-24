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
	BankLinePage,
	BankLineQuery,
	IfscLookup,
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
}
