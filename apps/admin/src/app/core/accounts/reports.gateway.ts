import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	FinancialStatement,
	PlByLocation,
	PlByLocationQuery,
	ReportCatalogue,
	ReportDefinition,
	ReportDefinitionWriteInput,
	ReportRunInput,
	ReportTable,
	StatementKind,
	StatementQuery,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const REPORT_KEYS = {
	all: ['reports'] as const,
	statement: (kind: StatementKind, query: StatementQuery) => ['reports', 'statement', kind, query] as const,
	plByLocation: (query: PlByLocationQuery) => ['reports', 'pl-by-location', query] as const,
	catalogue: ['reports', 'catalogue'] as const,
	saved: ['reports', 'saved'] as const,
	one: (id: string) => ['reports', 'saved', id] as const,
	run: (run: ReportRunInput) => ['reports', 'run', run] as const,
};

/** Reports (accounts brief U, V): statements, the builder and saved reports. */
@Injectable({ providedIn: 'root' })
export class ReportsGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/accounts/reports/${path}`;

	statement(kind: StatementKind, query: StatementQuery): Observable<FinancialStatement> {
		return this.http.get<FinancialStatement>(this.api(`statements/${kind}`), { params: { ...query } });
	}

	plByLocation(query: PlByLocationQuery): Observable<PlByLocation> {
		return this.http.get<PlByLocation>(this.api('pl-by-location'), { params: { ...query } });
	}

	catalogue(): Observable<ReportCatalogue> {
		return this.http.get<ReportCatalogue>(this.api('catalogue'));
	}

	run(run: ReportRunInput): Observable<ReportTable> {
		return this.http.post<ReportTable>(this.api('run'), run);
	}

	saved(): Observable<ReportDefinition[]> {
		return this.http.get<ReportDefinition[]>(this.api('saved'));
	}

	one(id: string): Observable<ReportDefinition> {
		return this.http.get<ReportDefinition>(this.api(`saved/${encodeURIComponent(id)}`));
	}

	create(write: ReportDefinitionWriteInput): Observable<ReportDefinition> {
		return this.http.post<ReportDefinition>(this.api('saved'), write);
	}

	update(id: string, write: ReportDefinitionWriteInput & { version: number }): Observable<ReportDefinition> {
		return this.http.put<ReportDefinition>(this.api(`saved/${encodeURIComponent(id)}`), write);
	}

	remove(id: string): Observable<void> {
		return this.http.delete<void>(this.api(`saved/${encodeURIComponent(id)}`));
	}
}
