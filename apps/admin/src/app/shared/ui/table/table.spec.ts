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
	const selected: number[][] = [];
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

	it('clears the selection when loading stops', () => {
		const { table, status } = render();
		table.selected = [1];
		status.set(false);
		TestBed.tick();
		expect(table.selected).toEqual([]);
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
		table.onChangeTable({ target: { value: '50' } }, 'paginate');
		expect(table.tableData['paginate']).toBe('50');
		table.onChangeTable({ target: null }, 'paginate');
		expect(table.tableData['paginate']).toBeUndefined();
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
		table.onChangeTable(null, 'other');
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
