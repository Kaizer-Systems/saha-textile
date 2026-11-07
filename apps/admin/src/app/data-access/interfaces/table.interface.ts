export interface ITableConfig<T extends IBaseRow = IBaseRow> {
	columns?: ITableColumn[];
	rowActions?: ITableAction[];
	data?: T[];
	total?: number;
	permission?: string | string[];
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
}

export interface ITableClickedAction {
	actionToPerform?: string;
	data?: any;
	value?: any;
}
