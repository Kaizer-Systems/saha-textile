import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	CashChoices,
	CashCountWrite,
	CashMoveWrite,
	CashSettingsView,
	CashSettingsWrite,
	CashSettleWrite,
	CashSheetList,
	CashSheetListQuery,
	CashSheetView,
	ClaimDecisionWrite,
	ClaimList,
	ClaimListQuery,
	CloseCountResult,
	ExpenseClaim,
	ExpenseClaimWrite,
	OpenSheetWrite,
	PettyCheck,
	PettyExpense,
	PettyExpenseWrite,
	PettyList,
	PettyListQuery,
	RefillPreview,
	RefillWrite,
	TodaysSheet,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const CASH_KEYS = {
	all: ['cash'] as const,
	settings: ['cash', 'settings'] as const,
	choices: ['cash', 'choices'] as const,
	today: (boxId: string | null) => ['cash', 'today', boxId] as const,
	sheet: (id: string) => ['cash', 'sheet', id] as const,
	sheets: (query: Partial<CashSheetListQuery>) => ['cash', 'sheets', query] as const,
	petty: (query: Partial<PettyListQuery>) => ['cash', 'petty', query] as const,
	claims: (query: Partial<ClaimListQuery>) => ['cash', 'claims', query] as const,
	claim: (id: string) => ['cash', 'claim', id] as const,
};

/** Cash (accounts brief O1–O14): boxes, sheets, counts, moves, settlements, petty expenses, refills and claims. */
@Injectable({ providedIn: 'root' })
export class CashGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/cash/${path}`;
	private readonly id = (value: string) => encodeURIComponent(value);

	settings(): Observable<CashSettingsView> {
		return this.http.get<CashSettingsView>(this.api('settings'));
	}

	saveSettings(write: CashSettingsWrite): Observable<CashSettingsView> {
		return this.http.put<CashSettingsView>(this.api('settings'), write);
	}

	choices(): Observable<CashChoices> {
		return this.http.get<CashChoices>(this.api('choices'));
	}

	today(boxId: string | null): Observable<TodaysSheet> {
		return this.http.get<TodaysSheet>(this.api('today'), { params: boxId ? { boxId } : {} });
	}

	open(write: OpenSheetWrite): Observable<CashSheetView> {
		return this.http.post<CashSheetView>(this.api('sheets'), write);
	}

	sheet(id: string): Observable<CashSheetView> {
		return this.http.get<CashSheetView>(this.api(`sheets/${this.id(id)}`));
	}

	sheets(query: Partial<CashSheetListQuery>): Observable<CashSheetList> {
		return this.http.get<CashSheetList>(this.api('sheets'), { params: { ...query } });
	}

	count(id: string, write: CashCountWrite): Observable<CloseCountResult> {
		return this.http.post<CloseCountResult>(this.api(`sheets/${this.id(id)}/count`), write);
	}

	submitDifference(id: string): Observable<CashSheetView> {
		return this.http.post<CashSheetView>(this.api(`sheets/${this.id(id)}/submit-difference`), { confirm: true });
	}

	move(id: string, write: CashMoveWrite): Observable<CashSheetView> {
		return this.http.post<CashSheetView>(this.api(`sheets/${this.id(id)}/moves`), write);
	}

	settle(id: string, write: CashSettleWrite): Observable<CashSheetView> {
		return this.http.post<CashSheetView>(this.api(`sheets/${this.id(id)}/settle`), write);
	}

	pettyCheck(boxId: string, paidTo: string, amountPaise: number): Observable<PettyCheck> {
		return this.http.get<PettyCheck>(this.api('petty/check'), {
			params: { boxId, paidTo, amountPaise: String(amountPaise) },
		});
	}

	pay(write: PettyExpenseWrite): Observable<PettyExpense> {
		return this.http.post<PettyExpense>(this.api('petty'), write);
	}

	petty(query: Partial<PettyListQuery>): Observable<PettyList> {
		return this.http.get<PettyList>(this.api('petty'), { params: { ...query } });
	}

	refillPreview(boxId: string): Observable<RefillPreview> {
		return this.http.get<RefillPreview>(this.api(`boxes/${this.id(boxId)}/refill`));
	}

	refill(boxId: string, write: RefillWrite): Observable<RefillPreview> {
		return this.http.post<RefillPreview>(this.api(`boxes/${this.id(boxId)}/refill`), write);
	}

	claims(query: Partial<ClaimListQuery>): Observable<ClaimList> {
		return this.http.get<ClaimList>(this.api('claims'), { params: { ...query } });
	}

	claim(id: string): Observable<ExpenseClaim & { locationName: string }> {
		return this.http.get<ExpenseClaim & { locationName: string }>(this.api(`claims/${this.id(id)}`));
	}

	createClaim(write: ExpenseClaimWrite): Observable<ExpenseClaim> {
		return this.http.post<ExpenseClaim>(this.api('claims'), write);
	}

	decide(id: string, write: ClaimDecisionWrite): Observable<ExpenseClaim> {
		return this.http.post<ExpenseClaim>(this.api(`claims/${this.id(id)}/decide`), write);
	}
}

/** The cash refusals the admin puts in words (accounts brief O); anything else says it failed, with its code. */
const CASH_CODES = new Set([
	'bank_required',
	'bill_not_found',
	'bill_photo_required',
	'cash_box_has_open_sheet',
	'cash_box_none_here',
	'cash_box_not_found',
	'cash_box_switched_off',
	'cash_close_another',
	'cash_count_matches',
	'cash_count_twice_first',
	'cash_difference_unsettled',
	'cash_limit_exceeded',
	'cash_move_needs_bank',
	'cash_move_same_box',
	'cash_no_denomination_on',
	'cash_nothing_to_settle',
	'cash_owner_settles',
	'cash_sheet_changed',
	'cash_sheet_exists',
	'cash_sheet_not_found',
	'cash_sheet_not_open',
	'cash_sheet_still_open',
	'claim_for_another',
	'claim_needs_a_box',
	'claim_own_approval',
	'consent_required',
	'count_repeats_a_denomination',
	'count_unknown_denomination',
	'deposit_date_required',
	'expense_claim_changed',
	'expense_claim_decided',
	'expense_claim_not_found',
	'ledger_required',
	'location_out_of_scope',
	'location_unknown',
	'not_a_fixed_float',
	'not_a_petty_head',
	'nothing_to_settle',
	'petty_gst_needs_our_gstin',
	'police_report_required',
	'recount_doesnt_match',
	'recount_required',
	'repay_by_required',
	'settlement_wrong_direction',
	'staff_required',
	'staff_unknown',
]);

export function cashProblemKey(message: string): { key: string; params: Record<string, string> } {
	if (CASH_CODES.has(message)) return { key: `cash_problem_${message}`, params: {} };
	if (message.startsWith('voucher_problem:role_not_mapped:'))
		return { key: 'cash_problem_role', params: { role: message.slice('voucher_problem:role_not_mapped:'.length) } };
	return { key: 'cash_failed', params: { code: message } };
}
