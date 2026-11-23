/**
 * A step refused because the books can't take its posting (Postings and Convert brief AP2): the code the API sends,
 * as a translation key and its values. Null for any other message, which is shown as it came.
 *
 * - `money_lands_not_set:received_by_bank` / `…:paid_by_bank` → no bank account in "Where money lands";
 * - `books_need_a_location` → no stock location to post against;
 * - `voucher_problem:role_not_mapped:<role>` / `…:role_ambiguous:<role>` → the chart lacks (or doubles) a ledger;
 * - `voucher_problem:<problem>` → the same words the voucher form uses (a locked month, a filed GST month…).
 */
export function booksRefusalKey(message: string): { key: string; params: Record<string, string> } | null {
	const role = /^voucher_problem:role_(not_mapped|ambiguous):(.+)$/.exec(message);
	if (role) return { key: `books_role_${String(role[1])}`, params: { role: String(role[2]) } };
	const problem = /^voucher_problem:([a-z_]+)$/.exec(message);
	if (problem) return { key: `accounts_problem_${String(problem[1])}`, params: {} };
	const landing = /^money_lands_not_set:(received_by_bank|paid_by_bank)$/.exec(message);
	if (landing) return { key: `books_no_bank_${String(landing[1])}`, params: {} };
	if (message === 'books_need_a_location') return { key: message, params: {} };
	return null;
}

/** The message in words when it is a books refusal; any other message unchanged. */
export function booksWords(
	message: string,
	translate: (key: string, params: Record<string, string>) => string,
): string {
	const refusal = booksRefusalKey(message);
	return refusal ? translate(refusal.key, refusal.params) : message;
}
