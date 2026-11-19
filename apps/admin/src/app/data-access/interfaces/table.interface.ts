export interface ITableConfig<T extends IBaseRow = IBaseRow> {
	columns?: ITableColumn[];
	rowActions?: ITableAction[];
	data?: T[];
	total?: number;
	permission?: string | string[];
	/** Extra buttons beside Delete while rows are ticked; each asks through the confirmation modal. */
	bulkActions?: ITableBulkAction[];
	/** How a ticked row shows in the chips and the picked list. Left out: its name or title. */
	pickView?: (row: T) => ITablePickView;
	/** The most rows one bulk action takes; past it the bar asks to act in two goes. */
	maxPicks?: number;
	/** False hides the table's own bulk Delete, for a page whose own bulk actions include it. */
	bulkDelete?: boolean;
}

/** A ticked row as the selection chips and the picked list show it. */
export interface ITablePickView {
	title: string;
	image?: string | null;
	/** A short line under the title in the list, e.g. "ST-SEM-3001 · ₹2,500". */
	detail?: string;
	/** A translation key, shown as a status pill. */
	status?: string;
	/** The pill's class: one of the admin's `status-*` pills. */
	statusClass?: string;
}

/** A button that acts on every ticked row. It is emitted with the ticked ids as `data`. */
export interface ITableBulkAction {
	/** A translation key. */
	label: string;
	actionToPerform: string;
	icon: string;
	permission?: string;
	/** Listed under "More" instead of in the bar. */
	more?: boolean;
	/** Drawn in the danger colour in a menu. */
	danger?: boolean;
	/** Emitted at once: the page asks its own question instead of the table's confirmation. */
	direct?: boolean;
}
export interface IBaseRow {
	id: number | string;
}

export interface ITableColumn {
	title?: string | undefined;
	dataField?: string;
	key?: string;
	sortable?: boolean;
	sort_direction?: string;
	type?: string;
	canAllow?: string[];
	date_format?: string;
	class?: string;
	placeholder?: string;
	/** Numbers sit right-aligned on one line (quantities, money). */
	align?: 'end';
	/** A set width in pixels: `theme-table` lays out fixed, so item columns need one. */
	width?: number;
	/** A `switch` column: the row field holding a translation key shown as a pill beside it. */
	labelField?: string;
	/** A `switch` column: the row field holding that pill's `status-*` class. */
	labelClassField?: string;
	/** A `switch` column: the row field that, when true, locks the switch. */
	lockField?: string;
}

export interface ITableAction {
	label: string;
	actionToPerform: string;
	icon: string;
	permission?: string | string[];
	/**
	 * Shown ONLY on rows whose `status` is `deleted` (a recycle-bin action such as Restore).
	 * Every other action keeps its old behaviour of being hidden on deleted rows.
	 */
	deletedRows?: boolean;
	/** Asks through the table's existing confirmation modal before the action is emitted. */
	confirm?: boolean;
	/** Shown only on rows whose `status` is one of these, for example Delete on drafts only. */
	rowStatuses?: string[];
}

export interface ITableClickedAction {
	actionToPerform?: string;
	data?: any;
	value?: any;
}
