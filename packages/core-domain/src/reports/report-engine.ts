/**
 * The custom report builder's engine (accounts brief V1): flat rows of one kind of data, the columns picked, filters,
 * groups, totals and a sort. Pure: the API reads the rows for the period, this works them into the table. Money is
 * paise; a percent is a number like 34.5.
 */

export type ReportFieldType = 'text' | 'number' | 'money' | 'date' | 'percent';
export type ReportDatasetKey = 'ledgerLines' | 'invoiceLines' | 'invoices';
export type ReportValue = string | number | null;
export type ReportRow = Readonly<Record<string, ReportValue>>;

export interface ReportField {
	key: string;
	type: ReportFieldType;
	/** Added up in groups and totals. */
	summable: boolean;
	/** A field worked out from others (after grouping, from their sums), with the fields it needs. */
	derived?: { from: readonly string[]; value: (row: ReportRow) => number | null };
}

const text = (key: string): ReportField => ({ key, type: 'text', summable: false });
const date = (key: string): ReportField => ({ key, type: 'date', summable: false });
const money = (key: string): ReportField => ({ key, type: 'money', summable: true });
const number = (key: string): ReportField => ({ key, type: 'number', summable: true });
const ratio = (key: string, top: string, bottom: string): ReportField => ({
	key,
	type: 'percent',
	summable: false,
	derived: {
		from: [top, bottom],
		value: (row) => {
			const a = row[top];
			const b = row[bottom];
			return typeof a === 'number' && typeof b === 'number' && b !== 0 ? Math.round((a / b) * 1000) / 10 : null;
		},
	},
});

/** Each kind of data and the fields it offers (V1 "Report on" and "Columns"). */
export const REPORT_DATASETS: Readonly<Record<ReportDatasetKey, readonly ReportField[]>> = {
	ledgerLines: [
		date('date'),
		text('month'),
		text('voucher'),
		text('voucherKind'),
		text('source'),
		text('ledger'),
		text('group'),
		text('location'),
		text('narration'),
		money('debit'),
		money('credit'),
		money('net'),
	],
	invoiceLines: [
		date('date'),
		text('month'),
		text('document'),
		text('documentKind'),
		text('gstin'),
		text('location'),
		text('buyer'),
		text('buyerGstin'),
		text('state'),
		text('product'),
		text('sku'),
		text('hsn'),
		text('unit'),
		number('quantity'),
		number('ratePercent'),
		money('taxable'),
		money('cgst'),
		money('sgst'),
		money('igst'),
		money('tax'),
		money('total'),
	],
	invoices: [
		date('date'),
		text('month'),
		text('document'),
		text('documentKind'),
		text('gstin'),
		text('location'),
		text('buyer'),
		text('buyerGstin'),
		text('state'),
		text('order'),
		money('taxable'),
		money('tax'),
		money('total'),
		money('cost'),
		money('margin'),
		ratio('marginPercent', 'margin', 'taxable'),
	],
};

export type ReportFilterOp = 'is' | 'isNot' | 'in' | 'contains' | 'gt' | 'lt' | 'between';

export interface ReportSpecLike {
	columns: readonly string[];
	filters: readonly { field: string; op: ReportFilterOp; values: readonly string[] }[];
	groupBy: readonly string[];
	totals: readonly string[];
	sort: { field: string; direction: 'asc' | 'desc' } | null;
}

export interface ReportTable {
	columns: { key: string; type: ReportFieldType }[];
	rows: ReportValue[][];
	/** Per column: the total of a summed column, else null. */
	totals: (number | null)[];
	/** Rows before the limit. */
	count: number;
	truncated: boolean;
}

/** The fields a spec names that its kind of data doesn't have, as `report_field_unknown:<key>`. */
export function specProblems(dataset: ReportDatasetKey, spec: ReportSpecLike): string[] {
	const known = new Set(REPORT_DATASETS[dataset].map((f) => f.key));
	const named = [...spec.columns, ...spec.filters.map((f) => f.field), ...spec.groupBy, ...spec.totals];
	if (spec.sort) named.push(spec.sort.field);
	const unknown = [...new Set(named.filter((key) => !known.has(key)))];
	const summed = spec.totals.filter(
		(key) => known.has(key) && !REPORT_DATASETS[dataset].find((f) => f.key === key)?.summable,
	);
	return [
		...unknown.map((key) => `report_field_unknown:${key}`),
		...summed.map((key) => `report_total_not_summable:${key}`),
	];
}

const comparable = (value: ReportValue, type: ReportFieldType): number | string | null => {
	if (value === null) return null;
	if (type === 'text' || type === 'date') return String(value).toLowerCase();
	return typeof value === 'number' ? value : Number(value);
};

/** Whether a row passes one filter; typed values are compared as their type (money in rupees as typed). */
function passes(row: ReportRow, field: ReportField, op: ReportFilterOp, values: readonly string[]): boolean {
	const typed = (raw: string) => {
		if (field.type === 'money') return Math.round(Number(raw) * 100);
		return field.type === 'text' || field.type === 'date' ? raw.toLowerCase() : Number(raw);
	};
	const value = comparable(row[field.key] ?? null, field.type);
	const wanted = values.map(typed);
	switch (op) {
		case 'is':
			return value === wanted[0];
		case 'isNot':
			return value !== wanted[0];
		case 'in':
			return wanted.includes(value as never);
		case 'contains':
			return typeof value === 'string' && value.includes(String(wanted[0] ?? ''));
		case 'gt':
			return value !== null && wanted[0] !== undefined && value > wanted[0];
		case 'lt':
			return value !== null && wanted[0] !== undefined && value < wanted[0];
		case 'between':
			return (
				value !== null &&
				wanted[0] !== undefined &&
				wanted[1] !== undefined &&
				value >= wanted[0] &&
				value <= wanted[1]
			);
	}
}

/**
 * V1: the table for a spec. Without groups each row is a row; with groups each group is one row of its group values
 * and the sums of its summed columns (derived columns worked out again from the sums). Totals add up every summed
 * column over all rows. Sorted by the sort, else by the first group, else as read; cut to `limit` rows.
 */
export function runReport(
	dataset: ReportDatasetKey,
	rows: readonly ReportRow[],
	spec: ReportSpecLike,
	limit: number,
): ReportTable {
	const problems = specProblems(dataset, spec);
	if (problems.length) throw new Error(problems[0]);
	const fields = new Map(REPORT_DATASETS[dataset].map((f) => [f.key, f]));
	const field = (key: string) => fields.get(key) as ReportField;
	const kept = rows.filter((row) => spec.filters.every((f) => passes(row, field(f.field), f.op, f.values)));

	const columns = spec.groupBy.length
		? [
				...spec.groupBy,
				...spec.columns.filter(
					(key) => !spec.groupBy.includes(key) && (field(key).summable || field(key).derived),
				),
			]
		: [...spec.columns];
	const withDerived = (row: Record<string, ReportValue>) => {
		for (const key of columns) {
			const derived = field(key).derived;
			if (derived) row[key] = derived.value(row);
		}
		return row;
	};
	const sumKeys = new Set<string>([
		...columns.filter((key) => field(key).summable),
		...spec.totals,
		...columns.flatMap((key) => field(key).derived?.from ?? []),
	]);

	let out: Record<string, ReportValue>[];
	if (spec.groupBy.length) {
		const groups = new Map<string, Record<string, ReportValue>>();
		for (const row of kept) {
			const id = JSON.stringify(spec.groupBy.map((key) => row[key] ?? null));
			const group = groups.get(id) ?? Object.fromEntries(spec.groupBy.map((key) => [key, row[key] ?? null]));
			for (const key of sumKeys) group[key] = Number(group[key] ?? 0) + Number(row[key] ?? 0);
			groups.set(id, group);
		}
		out = [...groups.values()].map(withDerived);
	} else {
		out = kept.map((row) => withDerived({ ...row }));
	}

	const sortKey = spec.sort?.field ?? spec.groupBy[0] ?? null;
	if (sortKey) {
		const direction = spec.sort?.direction === 'desc' ? -1 : 1;
		const type = field(sortKey).type;
		out.sort((a, b) => {
			const x = comparable(a[sortKey] ?? null, type);
			const y = comparable(b[sortKey] ?? null, type);
			if (x === y) return 0;
			if (x === null) return 1;
			if (y === null) return -1;
			return (x < y ? -1 : 1) * direction;
		});
	}

	// Every summed column and every asked total is in `sumKeys`, so the totals row holds each total shown.
	const totalsRow: Record<string, ReportValue> = {};
	for (const key of sumKeys) totalsRow[key] = kept.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
	return {
		columns: columns.map((key) => ({ key, type: field(key).type })),
		rows: out.slice(0, limit).map((row) => columns.map((key) => row[key] ?? null)),
		totals: columns.map((key) => {
			const derived = field(key).derived;
			if (derived) return derived.value(totalsRow);
			return spec.totals.includes(key) || (!spec.totals.length && field(key).summable)
				? (totalsRow[key] as number)
				: null;
		}),
		count: out.length,
		truncated: out.length > limit,
	};
}
