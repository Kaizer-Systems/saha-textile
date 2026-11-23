import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import { QUIET } from '../purchasing/purchasing.gateway';

import type {
	AccountGroup,
	AccountGroupWrite,
	AccountStatement,
	ChartOfAccounts,
	JournalVoucher,
	JournalVoucherWrite,
	Ledger,
	LedgerWrite,
	PeriodGrid,
	PeriodLock,
	PeriodLockWrite,
	VoucherKind,
	VoucherDetail,
	VoucherDraft,
	VoucherDraftWrite,
	VoucherPage,
	VoucherReverse,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const LEDGER_KEYS = {
	chart: ['accounts', 'chart'] as const,
	balances: (on: string) => ['accounts', 'balances', on] as const,
	statement: (id: string) => ['accounts', 'statement', id] as const,
	vouchers: ['accounts', 'vouchers'] as const,
	voucher: (id: string) => ['accounts', 'voucher', id] as const,
	drafts: ['accounts', 'drafts'] as const,
	draft: (id: string) => ['accounts', 'draft', id] as const,
	periods: ['accounts', 'periods'] as const,
};

/** Accounts › Ledgers, Vouchers, Periods and locks (accounts brief Q1–Q3, T1–T2). */
@Injectable({ providedIn: 'root' })
export class LedgerGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/accounts${path}`;

	chart(): Observable<ChartOfAccounts> {
		return this.http.get<ChartOfAccounts>(this.api('/chart'));
	}
	balances(on: string): Observable<Record<string, number>> {
		return this.http.get<Record<string, number>>(this.api('/balances'), { params: { on } });
	}
	addGroup(write: AccountGroupWrite): Observable<AccountGroup> {
		return this.http.post<AccountGroup>(this.api('/chart/groups'), write, QUIET);
	}
	addLedger(write: LedgerWrite): Observable<Ledger> {
		return this.http.post<Ledger>(this.api('/chart/ledgers'), write, QUIET);
	}
	saveLedger(id: string, write: LedgerWrite): Observable<Ledger> {
		return this.http.put<Ledger>(this.api(`/chart/ledgers/${encodeURIComponent(id)}`), write, QUIET);
	}
	statement(id: string, from: string, to: string, locationIds: string[]): Observable<AccountStatement> {
		let params = new HttpParams().set('from', from).set('to', to);
		for (const loc of locationIds) params = params.append('locationIds', loc);
		return this.http.get<AccountStatement>(this.api(`/ledgers/${encodeURIComponent(id)}/statement`), { params });
	}
	vouchers(q: {
		from: string;
		to: string;
		kinds: VoucherKind[];
		search: string;
		page: number;
	}): Observable<VoucherPage> {
		let params = new HttpParams().set('from', q.from).set('to', q.to).set('page', q.page).set('search', q.search);
		for (const kind of q.kinds) params = params.append('kinds', kind);
		return this.http.get<VoucherPage>(this.api('/vouchers'), { params });
	}
	voucher(id: string): Observable<VoucherDetail> {
		return this.http.get<VoucherDetail>(this.api(`/vouchers/${encodeURIComponent(id)}`));
	}
	drafts(): Observable<VoucherDraft[]> {
		return this.http.get<VoucherDraft[]>(this.api('/vouchers/drafts'));
	}
	draft(id: string): Observable<VoucherDraft> {
		return this.http.get<VoucherDraft>(this.api(`/vouchers/drafts/${encodeURIComponent(id)}`));
	}
	saveDraft(id: string | null, write: VoucherDraftWrite): Observable<VoucherDraft> {
		return id
			? this.http.put<VoucherDraft>(this.api(`/vouchers/drafts/${encodeURIComponent(id)}`), write, QUIET)
			: this.http.post<VoucherDraft>(this.api('/vouchers/drafts'), write, QUIET);
	}
	deleteDraft(id: string): Observable<void> {
		return this.http.delete<void>(this.api(`/vouchers/drafts/${encodeURIComponent(id)}`), QUIET);
	}
	post(write: JournalVoucherWrite): Observable<JournalVoucher> {
		return this.http.post<JournalVoucher>(this.api('/vouchers'), write, QUIET);
	}
	reverse(id: string, write: VoucherReverse): Observable<JournalVoucher> {
		return this.http.post<JournalVoucher>(this.api(`/vouchers/${encodeURIComponent(id)}/reverse`), write, QUIET);
	}
	periods(): Observable<PeriodGrid> {
		return this.http.get<PeriodGrid>(this.api('/periods'));
	}
	lock(write: PeriodLockWrite): Observable<PeriodLock[]> {
		return this.http.post<PeriodLock[]>(this.api('/periods'), write, QUIET);
	}
}
