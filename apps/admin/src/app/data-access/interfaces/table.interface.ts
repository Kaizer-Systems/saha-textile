export interface ITableConfig<T extends IBaseRow = IBaseRow> {
	columns?: ITableColumn[];
	rowActions?: ITableAction[];
	data?: T[];
	total?: number;
	permission?: string | string[];
}
export interface IBaseRow {
	id: number;
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
}

export interface ITableClickedAction {
	actionToPerform?: string;
	data?: any;
	value?: any;
}
