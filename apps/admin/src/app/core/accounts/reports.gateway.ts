import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	AgeingSide,
	AuditReport,
	AuditReportQuery,
	CaroStockReport,
	CashFlow,
	FinancialStatement,
	OutstandingAgeing,
	PeriodQuery,
	Ratios,
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
	ageing: (side: AgeingSide) => ['reports', 'ageing', side] as const,
	cashFlow: (query: PeriodQuery) => ['reports', 'cash-flow', query] as const,
	ratios: (query: PeriodQuery) => ['reports', 'ratios', query] as const,
	caroStock: (query: PeriodQuery & { locationId?: string }) => ['reports', 'caro-stock', query] as const,
	audit: (query: Partial<AuditReportQuery>) => ['reports', 'audit', query] as const,
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

	caroStock(query: PeriodQuery & { locationId?: string }): Observable<CaroStockReport> {
		return this.http.get<CaroStockReport>(this.api('caro-stock'), { params: { ...query } });
	}

	cashFlow(query: PeriodQuery): Observable<CashFlow> {
		return this.http.get<CashFlow>(this.api('cash-flow'), { params: { ...query } });
	}

	ratios(query: PeriodQuery): Observable<Ratios> {
		return this.http.get<Ratios>(this.api('ratios'), { params: { ...query } });
	}

	ageing(side: AgeingSide): Observable<OutstandingAgeing> {
		return this.http.get<OutstandingAgeing>(this.api(`ageing/${side}`));
	}

	audit(query: Partial<AuditReportQuery>): Observable<AuditReport> {
		return this.http.get<AuditReport>(this.api('audit'), { params: { ...query } });
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
