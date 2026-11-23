import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NgbDate, NgbDateParserFormatter } from '@ng-bootstrap/ng-bootstrap';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { LoaderStore } from '@core/state/loader.store';

import { Table } from './table';

const config = (overrides: Record<string, unknown> = {}) =>
	({
		data: [
			{ id: 1, system_reserve: '0' },
			{ id: 2, system_reserve: '1' },
		],
		rowActions: [
			{ actionToPerform: 'edit', permission: 'x.edit' },
			{ actionToPerform: 'delete', permission: 'x.delete' },
			{ actionToPerform: 'view' },
		],
		...overrides,
	}) as never;

const render = (held: string[] = ['x.edit', 'x.delete'], tableConfig: unknown = config()) => {
	const permissions = signal(held);
	const status = signal(true);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AuthStore, useValue: { permissions } },
			{ provide: LoaderStore, useValue: { status } },
		],
	});
	TestBed.overrideComponent(Table, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Table);
	const table = fixture.componentInstance;
	table.tableConfig = tableConfig as never;
	table.hasCheckbox = true;
	const changed: unknown[] = [];
	table.tableChanged.subscribe((value) => changed.push({ ...value }));
	const clicked: unknown[] = [];
	table.rowClicked.subscribe((value) => clicked.push(value));
	const actions: unknown[] = [];
	table.action.subscribe((value) => actions.push(value));
	const selected: (number | string)[][] = [];
	table.selectedItems.subscribe((value) => selected.push([...value]));
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, table, changed, clicked, actions, selected, permissions, status };
};

afterEach(() => {
	vi.useRealTimers();
	document.body.classList.remove('loader-none');
});

describe('Table start', () => {
	it('asks for the first page and reads the permissions', () => {
		const { changed, table } = render();
		expect(changed[0]).toMatchObject({ page: 1, paginate: 30 });
		expect(table.permissions).toEqual(['x.edit', 'x.delete']);
		expect(table.hasCheckbox).toBe(true);
	});

	it('waits for permissions to arrive', () => {
		const { table, permissions } = render([]);
		expect(table.permissions).toEqual([]);
		permissions.set(['x.edit']);
		TestBed.tick();
		expect(table.permissions).toEqual(['x.edit']);
	});

	it('hides the actions from someone holding none of them', () => {
		const { table } = render(['other']);
		expect(table.tableConfig.rowActions).toEqual([]);
	});

	it('keeps the actions when none needs a permission, and copes with no config', () => {
		const bare = render(['other'], config({ rowActions: [{ actionToPerform: 'view' }] }));
		expect(bare.table.tableConfig.rowActions).toHaveLength(1);
		const none = render(['other'], undefined);
		expect(none.table.hasPermission(['edit'])).toBe(false);
		expect(none.table.deleteButtonStatus).toBe(false);
		expect(none.table.duplicateButtonStatus).toBe(false);
	});

	it('drops the checkboxes without delete or duplicate rights', () => {
		expect(render(['x.edit']).table.hasCheckbox).toBe(false);
	});

	it('keeps the checkboxes when duplicating is allowed', () => {
		TestBed.resetTestingModule();
		const permissions = signal(['x.edit']);
		TestBed.configureTestingModule({
			providers: [
				{ provide: AuthStore, useValue: { permissions } },
				{ provide: LoaderStore, useValue: { status: signal(true) } },
			],
		});
		TestBed.overrideComponent(Table, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(Table);
		fixture.componentInstance.tableConfig = config();
		fixture.componentInstance.hasCheckbox = true;
		fixture.componentRef.setInput('hasDuplicate', true);
		fixture.detectChanges();
		TestBed.tick();
		expect(fixture.componentInstance.hasCheckbox).toBe(true);
	});

	it('keeps the ticks when the list reloads', () => {
		const { table, status } = render();
		table.setSelectedItem(true, 1);
		status.set(false);
		TestBed.tick();
		expect(table.selected).toEqual([1]);
	});

	it('keeps the checkboxes for a page with only its own bulk actions', () => {
		const bulkActions = [{ label: 'go_live', actionToPerform: 'bulk_go_live', icon: 'i', permission: 'x.edit' }];
		expect(render(['x.edit'], config({ bulkActions })).table.hasCheckbox).toBe(true);
	});
});

describe('Table changes', () => {
	it('searches after a pause and returns to page one', () => {
		vi.useFakeTimers();
		const { table, changed } = render();
		table.tableData['page'] = 3;
		table.term.setValue('silk');
		vi.advanceTimersByTime(400);
		expect(changed.at(-1)).toMatchObject({ search: 'silk', page: 1 });
		expect(document.body.classList.contains('loader-none')).toBe(true);
	});

	it.each([
		['asc', 'desc'],
		['desc', 'asc'],
		[undefined, 'desc'],
	])('flips a %s sort', (current, next) => {
		const { table } = render();
		const column = { sort_direction: current, dataField: 'name' };
		table.onChangeTable(column, 'sort');
		expect(column.sort_direction).toBe(next);
		expect(table.tableData['field']).toBe('name');
		expect(table.tableData['sort']).toBe('desc');
		table.onChangeTable(column, 'sort');
		expect(table.tableData['sort']).toBe('asc');
	});

	it('ignores a column that cannot sort', () => {
		const { table } = render();
		const column = { sortable: false };
		table.onChangeTable(column, 'sort');
		expect(table.tableData['field']).toBe('');
		table.onChangeTable(null, 'sort');
		expect(table.tableData['field']).toBe('');
	});

	it('changes the page size and the page', () => {
		const { table } = render();
		table.onChangeTable({ target: { value: '50' } } as unknown as Event, 'paginate');
		expect(table.tableData['paginate']).toBe(50);
		table.onChangeTable({ target: null } as unknown as Event, 'paginate');
		expect(table.tableData['paginate']).toBe(50);
		table.onChangeTable(2, 'page');
		expect(table.tableData['page']).toBe(2);
	});

	it('applies a whole date range only', () => {
		const { table, changed } = render();
		table.onChangeTable({ start_date: 'a', end_date: 'b' }, 'daterange');
		expect(table.tableData).toMatchObject({ start_date: 'a', end_date: 'b' });
		const before = changed.length;
		table.onChangeTable({ start_date: 'a' }, 'daterange');
		expect(changed.length).toBe(before);
		expect(table.tableData['start_date']).toBeUndefined();
		table.onChangeTable({ start_date: 'a', end_date: 'undefined-undefined' }, 'daterange');
		expect(changed.length).toBe(before + 1);
		table.onChangeTable(null, 'daterange');
		expect(changed.length).toBe(before + 2);
	});

	it('passes an unknown change through', () => {
		const { table, changed } = render();
		const before = changed.length;
		// Not a change the table knows: passed on as it is.
		table.onChangeTable(null, 'other' as never);
		expect(changed.length).toBe(before + 1);
	});
});

describe('Table actions', () => {
	it('reports an action with or without the permission', () => {
		const { table, actions } = render();
		const row = { id: 1 };
		table.onActionClicked('edit', row, 1);
		table.onActionClicked('status', row, 0);
		expect(actions).toHaveLength(2);
		expect(row).toMatchObject({ edit: 1, status: 0 });
	});

	it('opens a row only for someone who may', () => {
		const allowed = render();
		allowed.table.onRowClicked({ id: 1 });
		expect(allowed.clicked).toEqual([{ id: 1 }]);
		const denied = render(['x.delete']);
		denied.table.onRowClicked({ id: 1 });
		expect(denied.clicked).toEqual([]);
	});

	it('refuses a permission list', () => {
		const { table } = render(
			['x.edit'],
			config({ rowActions: [{ actionToPerform: 'edit', permission: ['x.edit'] }] }),
		);
		expect(table.hasPermission(['edit'])).toBe(false);
		expect(table.hasPermission()).toBe(false);
	});
});

describe('Table selection', () => {
	it('selects everything but reserved rows, and unselects', () => {
		const { table, selected } = render();
		table.checkUncheckAll({ target: { checked: true } } as never);
		expect(table.selected).toEqual([1]);
		table.checkUncheckAll({ target: { checked: true } } as never);
		expect(table.selected).toEqual([1]);
		table.checkUncheckAll({ target: { checked: false } } as never);
		expect(table.selected).toEqual([]);
		expect(selected.length).toBeGreaterThan(1);
		table.checkUncheckAll({ target: null } as never);
		expect(table.selected).toEqual([]);
	});

	it('toggles one item', () => {
		const { table } = render();
		table.onItemChecked({ target: { checked: true, value: '1' } } as never);
		expect(table.selected).toEqual([1]);
		table.onItemChecked({ target: null } as never);
		expect(table.selected).toEqual([1]);
	});

	it('keeps text ids as text, so rows the API fills can be selected', () => {
		const { table } = render();
		table.tableConfig = { ...table.tableConfig, data: [{ id: 'blg_1' }, { id: 'blg_2' }] } as never;
		table.onItemChecked({ target: { checked: true, value: 'blg_2' } } as never);
		table.checkUncheckAll({ target: { checked: true } } as never);
		expect(table.selected).toEqual(['blg_2', 'blg_1']);
		table.onItemChecked({ target: { checked: false, value: 'blg_2' } } as never);
		expect(table.selected).toEqual(['blg_1']);
	});

	it('shows the bulk buttons the operator may use while anything is ticked, on any page', () => {
		const bulkActions = [
			{ label: 'go_live', actionToPerform: 'bulk_go_live', icon: 'i', permission: 'x.edit' },
			{ label: 'other', actionToPerform: 'bulk_other', icon: 'i', permission: 'x.publish' },
			{ label: 'open', actionToPerform: 'bulk_open', icon: 'i', more: true },
		];
		const { table } = render(['x.edit'], config({ bulkActions }));
		expect(table.visibleBulkActions).toEqual([]);
		table.selected = [99];
		expect(table.visibleBulkActions.map((action) => action.actionToPerform)).toEqual(['bulk_go_live', 'bulk_open']);
		expect(table.barActions.map((action) => action.actionToPerform)).toEqual(['bulk_go_live']);
		expect(table.moreActions.map((action) => action.actionToPerform)).toEqual(['bulk_open']);
		const plain = render(['x.edit']);
		plain.table.selected = [1];
		expect(plain.table.visibleBulkActions).toEqual([]);
	});

	it('enables delete and duplicate for selected rows with the right', () => {
		const { table } = render();
		expect(table.deleteButtonStatus).toBe(false);
		table.selected = [1];
		expect(table.deleteButtonStatus).toBe(true);
		expect(table.duplicateButtonStatus).toBe(true);
		const denied = render(['other'], config({ rowActions: [{ actionToPerform: 'edit' }] }));
		denied.table.selected = [1];
		expect(denied.table.deleteButtonStatus).toBe(false);
		expect(denied.table.duplicateButtonStatus).toBe(false);
		const own = render(undefined, config({ bulkDelete: false }));
		own.table.selected = [1];
		expect(own.table.deleteButtonStatus).toBe(false);
	});
});

describe('Table picks', () => {
	const rows = (...ids: string[]) => ids.map((id) => ({ id, name: `<b>${id}</b> Saree` }));
	const withRows = (data = rows('p1', 'p2', 'p3'), extra: Record<string, unknown> = {}) =>
		render(['x.edit', 'x.delete'], config({ data, ...extra }));

	afterEach(() => sessionStorage.clear());

	it('keeps a pick from another page, and the header box counts this page only', () => {
		const { table } = withRows();
		table.setSelectedItem(true, 'p1');
		expect(table.someOnPage).toBe(true);
		table.tableConfig = { ...table.tableConfig, data: rows('p4', 'p5') } as never;
		expect(table.selected).toEqual(['p1']);
		expect(table.pickedOnPage).toBe(0);
		table.checkUncheckAll({ target: { checked: true } } as never);
		expect(table.allOnPage).toBe(true);
		expect(table.selected).toEqual(['p1', 'p4', 'p5']);
		table.checkUncheckAll({ target: { checked: false } } as never);
		expect(table.selected).toEqual(['p1']);
		expect(table.pickList.map((pick) => pick.view.title)).toEqual(['p1 Saree']);
	});

	it('shows six chips, folds the rest, and drops one from a chip', () => {
		const { table, selected } = withRows(rows('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'));
		table.checkUncheckAll({ target: { checked: true } } as never);
		expect(table.chips).toHaveLength(6);
		expect(table.chipOverflow).toBe(2);
		table.unpick('a');
		expect(table.selected).not.toContain('a');
		expect(selected.at(-1)).not.toContain('a');
		table.dropPicks(['b', 'c']);
		expect(table.selected).toHaveLength(5);
		table.clearPicks();
		expect(table.selected).toEqual([]);
	});

	it('names picks through the page’s own view, and refreshes them from the page', () => {
		const pickView = (row: { id: string; status: string }) => ({
			title: row.id,
			status: row.status,
			statusClass: 'status-success',
		});
		const { table } = withRows(
			[
				{ id: 'p1', status: 'live' },
				{ id: 'p2', status: 'draft' },
			] as never,
			{ pickView },
		);
		table.checkUncheckAll({ target: { checked: true } } as never);
		expect(table.pickCounts).toEqual([
			{ status: 'live', count: 1 },
			{ status: 'draft', count: 1 },
		]);
		table.tableConfig = { ...table.tableConfig, data: [{ id: 'p2', status: 'live' }] } as never;
		expect(table.pickCounts).toEqual([{ status: 'live', count: 2 }]);
		expect(table.pickedRows<{ id: string; status: string }>(['p2'])).toEqual([{ id: 'p2', status: 'live' }]);
		expect(table.pickedRows()).toHaveLength(2);
	});

	it('marks the picks an action could not do, and opens a pick like a row', () => {
		const { table, clicked } = withRows();
		table.setSelectedItem(true, 'p2');
		table.markPicks(new Map([['p2', 'বাংলা Name']]));
		expect(table.pickList[0]?.problem).toBe('বাংলা Name');
		table.openPick(table.pickList[0] as never);
		expect(clicked).toEqual([expect.objectContaining({ id: 'p2' })]);
	});

	it('emits its own bulk actions at once, and asks first for the others', () => {
		const { table, actions } = withRows(undefined, {
			bulkActions: [
				{ label: 'go_live', actionToPerform: 'bulk_go_live', icon: 'i', direct: true },
				{ label: 'other', actionToPerform: 'bulk_other', icon: 'i' },
			],
			maxPicks: 2,
		});
		table.setSelectedItem(true, 'p1');
		table.runBulk(table.barActions[0] as never);
		expect(actions).toEqual([{ actionToPerform: 'bulk_go_live', data: ['p1'] }]);
		table.runBulk(table.barActions[1] as never);
		expect(actions).toHaveLength(1);
		table.checkUncheckAll({ target: { checked: true } } as never);
		expect(table.overLimit).toBe(true);
		table.runBulk(table.barActions[0] as never);
		expect(actions).toHaveLength(1);
	});

	it('drops the picks its own Delete removed', () => {
		const { table, actions } = withRows();
		table.setSelectedItem(true, 'p1');
		table.setSelectedItem(true, 'p2');
		table.onDeleteConfirmed({ actionToPerform: 'deleteAll', data: ['p1'] });
		expect(actions.at(-1)).toMatchObject({ actionToPerform: 'deleteAll' });
		expect(table.selected).toEqual(['p2']);
		table.onDeleteConfirmed({ actionToPerform: 'delete', data: { id: 'p2' } });
		expect(table.selected).toEqual(['p2']);
	});

	it('copes with what a page can lack: a tick from elsewhere, no rows, picks without a status, an action on nothing', () => {
		const { table, actions } = withRows();
		// A tick on a row this page does not show keeps only its id until its page shows it.
		table.setSelectedItem(true, 'elsewhere');
		expect(table.pickList.find((pick) => pick.id === 'elsewhere')?.row).toEqual({ id: 'elsewhere' });
		// Picks named without a status are left out of the counts; one an action did not mention has no problem.
		expect(table.pickCounts).toEqual([]);
		table.markPicks(new Map());
		expect(table.pickList.map((pick) => pick.problem)).toEqual([null]);
		// A page with no rows: nothing to tick on it, and the picks from elsewhere stay.
		table.tableConfig = { ...table.tableConfig, data: undefined } as never;
		expect(table.pickedOnPage).toBe(0);
		expect(table.selected).toEqual(['elsewhere']);
		// An action that carries nothing still goes out as it is.
		table.onActionClicked('view', null);
		expect(actions.at(-1)).toEqual({ actionToPerform: 'view', data: null });
	});

	it('keeps the picks for this browser tab under the list’s name', () => {
		const make = () => {
			TestBed.resetTestingModule();
			TestBed.configureTestingModule({
				providers: [
					{ provide: AuthStore, useValue: { permissions: signal(['x.edit', 'x.delete']) } },
					{ provide: LoaderStore, useValue: { status: signal(true) } },
				],
			});
			TestBed.overrideComponent(Table, { set: { imports: [], template: '' } });
			const fixture = TestBed.createComponent(Table);
			fixture.componentInstance.tableConfig = config({ data: rows('p1', 'p2') });
			fixture.componentInstance.hasCheckbox = true;
			fixture.componentRef.setInput('selectionKey', 'products');
			fixture.detectChanges();
			return fixture.componentInstance;
		};
		const first = make();
		first.setSelectedItem(true, 'p2');
		first.markPicks(new Map([['p2', 'gap']]));
		const second = make();
		expect(second.selected).toEqual(['p2']);
		expect(second.pickList[0]).toMatchObject({ problem: 'gap', view: { title: 'p2 Saree' } });
		second.clearPicks();
		expect(sessionStorage.getItem('saha-textile:table-picks:products')).toBeNull();
		sessionStorage.setItem('saha-textile:table-picks:products', '{bad');
		expect(make().selected).toEqual([]);
		sessionStorage.setItem('saha-textile:table-picks:products', JSON.stringify({ not: 'a list' }));
		expect(make().selected).toEqual([]);
		sessionStorage.setItem('saha-textile:table-picks:products', JSON.stringify([{ id: 'x' }, null]));
		expect(make().selected).toEqual([]);
		// A saved tick from before a problem or a time was kept: none, and the oldest.
		sessionStorage.setItem(
			'saha-textile:table-picks:products',
			JSON.stringify([{ id: 'p9', row: { id: 'p9' }, view: { title: 'p9' }, problem: 5 }]),
		);
		expect(make().pickList[0]).toMatchObject({ id: 'p9', problem: null, at: 0 });
	});
});

describe('Table dates', () => {
	const day = (value: number) => new NgbDate(2026, 11, value);

	it('builds a range from two picks, and restarts on an earlier one', () => {
		const { table } = render();
		table.onDateSelection(day(5));
		expect(table.fromDate?.day).toBe(5);
		table.onDateSelection(day(9));
		expect(table.toDate?.day).toBe(9);
		table.onDateSelection(day(7));
		expect(table.fromDate?.day).toBe(7);
		expect(table.toDate).toBeNull();
		table.onDateSelection(day(2));
		expect(table.fromDate?.day).toBe(2);
	});

	it('marks hovered, inside and range days', () => {
		const { table } = render();
		table.fromDate = day(5);
		table.hoveredDate = day(9);
		expect(table.isHovered(day(7))).toBe(true);
		table.toDate = day(9);
		expect(table.isHovered(day(7))).toBeFalsy();
		expect(table.isInside(day(7))).toBe(true);
		expect(table.isRange(day(5))).toBe(true);
		expect(table.isRange(day(9))).toBe(true);
		expect(table.isRange(day(7))).toBe(true);
		expect(table.isRange(day(20))).toBeFalsy();
		table.toDate = null;
		expect(table.isRange(day(7))).toBeTruthy();
	});

	it('validates typed dates', () => {
		const { table } = render();
		const formatter = TestBed.inject(NgbDateParserFormatter);
		vi.spyOn(formatter, 'parse').mockReturnValueOnce({ year: 2026, month: 11, day: 5 });
		expect(table.validateInput(null, 'ok')?.day).toBe(5);
		vi.spyOn(formatter, 'parse').mockReturnValueOnce(null);
		expect(table.validateInput(day(1), 'no')?.day).toBe(1);
		vi.spyOn(formatter, 'parse').mockReturnValueOnce({ year: 2026, month: 13, day: 5 });
		expect(table.validateInput(day(1), 'bad')?.day).toBe(1);
	});

	it('clears the range', () => {
		const { table } = render();
		table.fromDate = day(5);
		table.clearDateRange();
		expect(table.fromDate).toBeNull();
	});

	it('removes the body class when leaving', () => {
		const { fixture } = render();
		document.body.classList.add('loader-none');
		fixture.destroy();
		expect(document.body.classList.contains('loader-none')).toBe(false);
	});
});
