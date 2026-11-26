/**
 * Bringing books in from another program (accounts brief I1, W1–W3) and taking them out (W4). Pure: reading a
 * TallyPrime masters export or our CSV template into ledgers with their opening balances (debit positive, paise),
 * matching each to ours (by name, by tax head, parties to the control ledgers, a new ledger under the matching group,
 * or the person chooses), the checks before bringing in, the opening voucher's lines, and a Tally XML export.
 */

export interface ImportedLedger {
	name: string;
	/** The group it sat in, as the other program named it. */
	group: string;
	/** That group's top (primary) group, when known. */
	primary: string | null;
	openingPaise: number;
}

/** TallyPrime's primary groups, as Tally spells them, and where each sits in our chart (the first per group exports). */
export const TALLY_PRIMARY: readonly (readonly [string, string])[] = [
	['Capital Account', 'capital_account'],
	['Reserves & Surplus', 'reserves_and_surplus'],
	['Current Assets', 'current_assets'],
	['Current Liabilities', 'current_liabilities'],
	['Duties & Taxes', 'duties_and_taxes'],
	['Provisions', 'provisions'],
	['Sundry Creditors', 'sundry_creditors'],
	['Sundry Debtors', 'sundry_debtors'],
	['Bank Accounts', 'bank_accounts'],
	['Bank OD A/c', 'bank_od'],
	['Bank OCC A/c', 'bank_od'],
	['Cash-in-Hand', 'cash_in_hand'],
	['Deposits (Asset)', 'current_assets'],
	['Loans & Advances (Asset)', 'loans_and_advances'],
	['Stock-in-Hand', 'stock_in_hand'],
	['Fixed Assets', 'fixed_assets'],
	['Investments', 'investments'],
	['Loans (Liability)', 'loans_liability'],
	['Secured Loans', 'secured_loans'],
	['Unsecured Loans', 'unsecured_loans'],
	['Sales Accounts', 'sales_accounts'],
	// Direct Expenses first: an export names a direct expense's group by the first match (freight in is not a purchase).
	['Direct Expenses', 'direct_expenses'],
	['Purchase Accounts', 'direct_expenses'],
	['Direct Incomes', 'direct_incomes'],
	['Indirect Expenses', 'indirect_expenses'],
	['Indirect Incomes', 'indirect_incomes'],
	['Suspense A/c', 'suspense_account'],
	['Branch / Divisions', 'branch_divisions'],
	['Misc. Expenses (ASSET)', 'current_assets'],
];

/** The same, by the group's name in lower case. */
export const TALLY_GROUPS: Readonly<Record<string, string>> = Object.fromEntries(
	TALLY_PRIMARY.map(([name, key]) => [name.toLowerCase(), key]),
);

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML text with its entities read (named ones and numeric character references). */
export function xmlText(raw: string): string {
	return raw
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
		.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] as string)
		.trim();
}

const tag = (block: string, name: string): string | null => {
	const found = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
	return found ? xmlText(found[1] as string) : null;
};

/** A Tally amount ("-18420.00", "41,200.00 Cr"): Tally writes debits as negative, so debit positive is its negative. */
export function tallyAmountPaise(text: string | null): number {
	if (!text) return 0;
	const clean = text.replace(/,/g, '').trim();
	const match = /^(-?\d+(?:\.\d+)?)\s*(Dr|Cr)?$/i.exec(clean);
	if (!match) return 0;
	const value = Math.round(Number(match[1]) * 100);
	const side = match[2]?.toLowerCase();
	if (side === 'dr') return Math.abs(value);
	if (side === 'cr') return -Math.abs(value);
	return -value;
}

/** The primary group a group sits under, walking up the groups read from the same file. */
export function primaryOf(group: string, parents: ReadonlyMap<string, string>): string | null {
	let current = group;
	for (let i = 0; i < 50; i++) {
		if (TALLY_GROUPS[current.toLowerCase()]) return current;
		const parent = parents.get(current.toLowerCase());
		if (!parent) return null;
		current = parent;
	}
	return null;
}

/** A TallyPrime masters export (XML): every ledger with its group and opening balance. */
export function parseTallyMasters(xml: string): ImportedLedger[] {
	const parents = new Map<string, string>();
	for (const found of xml.matchAll(/<GROUP\s+NAME="([^"]*)"[^>]*>([\s\S]*?)<\/GROUP>/gi)) {
		const parent = tag(found[2] as string, 'PARENT');
		if (parent) parents.set(xmlText(found[1] as string).toLowerCase(), parent);
	}
	const out: ImportedLedger[] = [];
	for (const found of xml.matchAll(/<LEDGER\s+NAME="([^"]*)"[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
		const body = found[2] as string;
		const group = tag(body, 'PARENT') ?? '';
		out.push({
			name: xmlText(found[1] as string),
			group,
			primary: primaryOf(group, parents),
			openingPaise: tallyAmountPaise(tag(body, 'OPENINGBALANCE')),
		});
	}
	return out;
}

/** One CSV line split into cells, quotes respected. */
export function csvCells(line: string): string[] {
	const cells: string[] = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i] as string;
		if (quoted) {
			if (ch === '"' && line[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			cells.push(cell.trim());
			cell = '';
		} else cell += ch;
	}
	cells.push(cell.trim());
	return cells;
}

const money = (text: string | undefined) => Math.round(Number((text ?? '').replace(/[₹,\s]/g, '') || 0) * 100);

/**
 * Our CSV template (and any program's trial balance laid out the same way): Ledger, Group, Debit, Credit. Rows with
 * no name are skipped; a group named like one of Tally's primary groups is placed by it.
 */
export function parseTemplateCsv(text: string): ImportedLedger[] {
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	const header = (lines[0] ? csvCells(lines[0]) : []).map((h) => h.toLowerCase());
	const at = (name: string) => header.indexOf(name);
	const [iName, iGroup, iDebit, iCredit] = [at('ledger'), at('group'), at('debit'), at('credit')];
	if (iName < 0 || iGroup < 0 || iDebit < 0 || iCredit < 0) return [];
	return lines.slice(1).flatMap((line) => {
		const cells = csvCells(line);
		const name = cells[iName] ?? '';
		if (!name) return [];
		const group = cells[iGroup] ?? '';
		return [
			{
				name,
				group,
				primary: TALLY_GROUPS[group.toLowerCase()] ? group : null,
				openingPaise: money(cells[iDebit]) - money(cells[iCredit]),
			},
		];
	});
}

export type MatchHow = 'by_name' | 'by_tax_head' | 'party' | 'new' | 'choose';

export interface LedgerMatch {
	name: string;
	how: MatchHow;
	/** The ledger it goes to; null for a new ledger or one still to choose. */
	ledgerId: string | null;
	/** For a new ledger: the group it is made under. */
	groupKey: string | null;
}

interface ChartLike {
	groups: readonly { id: string; systemKey: string | null }[];
	ledgers: readonly { id: string; name: string; systemKey: string | null; roles?: readonly string[] | null }[];
}

const TAX_HEADS: readonly [RegExp, string][] = [
	[/output.*cgst|cgst.*output/i, 'output_cgst'],
	[/output.*sgst|sgst.*output|output.*utgst/i, 'output_sgst'],
	[/output.*igst|igst.*output/i, 'output_igst'],
	[/input.*cgst|cgst.*input/i, 'input_cgst'],
	[/input.*sgst|sgst.*input|input.*utgst/i, 'input_sgst'],
	[/input.*igst|igst.*input/i, 'input_igst'],
	[/\btds\b/i, 'tds_payable'],
];

const byKey = (chart: ChartLike, key: string) =>
	chart.ledgers.find((l) => l.systemKey === key || (l.roles ?? []).includes(key))?.id ?? null;

/** W2: where each imported ledger goes. */
export function matchLedgers(imported: readonly ImportedLedger[], chart: ChartLike): LedgerMatch[] {
	const ours = new Map(chart.ledgers.map((l) => [l.name.trim().toLowerCase(), l.id]));
	return imported.map((l) => {
		const named = ours.get(l.name.trim().toLowerCase());
		if (named) return { name: l.name, how: 'by_name', ledgerId: named, groupKey: null };
		const key = l.primary ? (TALLY_GROUPS[l.primary.toLowerCase()] ?? null) : null;
		if (key === 'duties_and_taxes') {
			const head = TAX_HEADS.find(([pattern]) => pattern.test(l.name));
			const id = head ? byKey(chart, head[1]) : null;
			if (id) return { name: l.name, how: 'by_tax_head', ledgerId: id, groupKey: null };
		}
		if (key === 'sundry_debtors' || key === 'sundry_creditors') {
			const id = byKey(chart, key === 'sundry_debtors' ? 'debtors_control' : 'creditors_control');
			if (id) return { name: l.name, how: 'party', ledgerId: id, groupKey: null };
		}
		if (key && chart.groups.some((g) => g.systemKey === key))
			return { name: l.name, how: 'new', ledgerId: null, groupKey: key };
		return { name: l.name, how: 'choose', ledgerId: null, groupKey: null };
	});
}

export interface ImportCheck {
	debitPaise: number;
	creditPaise: number;
	balanced: boolean;
	/** Ledgers with a balance still to be placed. */
	toChoose: number;
}

/** W3: whether the opening trial balance balances and every ledger with a balance has a place. */
export function importCheck(imported: readonly ImportedLedger[], matches: readonly LedgerMatch[]): ImportCheck {
	let debitPaise = 0;
	let creditPaise = 0;
	let toChoose = 0;
	imported.forEach((l, i) => {
		if (l.openingPaise > 0) debitPaise += l.openingPaise;
		else creditPaise -= l.openingPaise;
		const m = matches[i];
		if (l.openingPaise && (!m || (m.how === 'choose' && !m.ledgerId && !m.groupKey))) toChoose += 1;
	});
	return { debitPaise, creditPaise, balanced: debitPaise === creditPaise, toChoose };
}

/** W3 Bring in: one line per ledger with a balance (parties keep their name in the line's narration). */
export function openingLines(
	imported: readonly ImportedLedger[],
	ledgerIds: readonly (string | null)[],
	parties: readonly boolean[],
): { ledgerId: string; narration: string; debitPaise?: number; creditPaise?: number }[] {
	return imported.flatMap((l, i) => {
		const id = ledgerIds[i];
		if (!l.openingPaise || !id) return [];
		const narration = parties[i] ? `Opening balance · ${l.name}` : 'Opening balance';
		return [
			l.openingPaise > 0
				? { ledgerId: id, narration, debitPaise: l.openingPaise }
				: { ledgerId: id, narration, creditPaise: -l.openingPaise },
		];
	});
}

const xmlSafe = (text: string) =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tallyAmount = (debitPaise: number) => (-debitPaise / 100).toFixed(2);

/** Our group keys back to Tally's primary groups, for an export Tally can read (anything else to Suspense A/c). */
export function tallyGroupFor(groupKey: string | null): string {
	return TALLY_PRIMARY.find(([, key]) => key === groupKey)?.[0] ?? 'Suspense A/c';
}

/** W4: a TallyPrime import file with the ledgers (and their primary groups) and the vouchers as journals. */
export function tallyXml(
	ledgers: readonly { name: string; groupKey: string | null; openingPaise: number }[],
	vouchers: readonly {
		number: string;
		date: string;
		narration: string;
		lines: readonly { ledger: string; debitPaise: number }[];
	}[],
): string {
	const masters = ledgers.map(
		(l) =>
			`<TALLYMESSAGE><LEDGER NAME="${xmlSafe(l.name)}" ACTION="Create"><NAME>${xmlSafe(l.name)}</NAME><PARENT>${xmlSafe(tallyGroupFor(l.groupKey))}</PARENT><OPENINGBALANCE>${tallyAmount(l.openingPaise)}</OPENINGBALANCE></LEDGER></TALLYMESSAGE>`,
	);
	const entries = vouchers.map((v) => {
		const lines = v.lines
			.map(
				(line) =>
					`<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlSafe(line.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${line.debitPaise > 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${tallyAmount(line.debitPaise)}</AMOUNT></ALLLEDGERENTRIES.LIST>`,
			)
			.join('');
		return `<TALLYMESSAGE><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>${v.date.replace(/-/g, '')}</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>${xmlSafe(v.number)}</VOUCHERNUMBER><NARRATION>${xmlSafe(v.narration)}</NARRATION>${lines}</VOUCHER></TALLYMESSAGE>`;
	});
	return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC><REQUESTDATA>${[...masters, ...entries].join('')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}
