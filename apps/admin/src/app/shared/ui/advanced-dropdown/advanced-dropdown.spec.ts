import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { AdvancedDropdown } from './advanced-dropdown';
import { DropdownList } from './dropdown-list/dropdown-list';

const options = () => [
	{ id: 1, name: 'Sarees', subcategories: [{ id: 2, name: 'Silk', subcategories: [] }] },
	{ id: 3, name: 'Dress', subcategories: [] },
	{ name: 'No id' },
];

const render = (inputs: Record<string, unknown> = {}) => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(AdvancedDropdown, {
		set: {
			imports: [],
			template: '<div #dropdownContainer><div class="dropdown-open"></div></div>',
		},
	});
	const fixture = TestBed.createComponent(AdvancedDropdown);
	fixture.componentRef.setInput('options', options());
	fixture.componentRef.setInput('subArrayKey', 'subcategories');
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	const dropdown = fixture.componentInstance;
	dropdown.ngOnChanges();
	const seen: number[][] = [];
	dropdown.selectedItem.subscribe((value) => seen.push([...value]));
	return { fixture, dropdown, seen };
};

describe('AdvancedDropdown selection', () => {
	it('starts with nothing selected', () => {
		expect(render().dropdown.selectedIds).toEqual([]);
		expect(render({ selectedOption: null }).dropdown.selectedIds).toEqual([]);
	});

	it('finds the selected options at any depth', () => {
		expect(render({ selectedOption: ['2', 3] }).dropdown.selectedIds).toEqual([2, 3]);
	});

	it('adds, and removes on a second press', () => {
		const { dropdown, seen } = render();
		const item = { id: 9, name: 'x', selected: false };
		dropdown.onSelect(item);
		expect(dropdown.selectedIds).toEqual([9]);
		dropdown.onSelect(item);
		expect(dropdown.selectedIds).toEqual([]);
		expect(seen.length).toBeGreaterThan(1);
	});

	it('keeps an item that is flagged selected', () => {
		const { dropdown } = render();
		const item = { id: 9, name: 'x', selected: true };
		dropdown.onSelect(item);
		dropdown.onSelect(item);
		expect(dropdown.selectedIds).toEqual([9]);
	});

	it('holds one item in single mode', () => {
		const { dropdown } = render({ selectSingle: true });
		dropdown.onSelect({ id: 1 });
		dropdown.onSelect({ id: 2 });
		expect(dropdown.selectedIds).toEqual([2]);
	});
});

describe('AdvancedDropdown search', () => {
	const named = () => [
		{ id: 1, name: 'Sarees', subcategories: [{ id: 2, name: 'Silk', subcategories: [] }] },
		{ id: 3, name: 'Dress', subcategories: [] },
	];

	it('matches an item or one of its children, and restores on clear', () => {
		const { dropdown } = render({ options: named() });
		dropdown.term.setValue('silk');
		expect(dropdown.optionsData.map((item) => item.id)).toEqual([1]);
		dropdown.term.setValue('dress');
		expect(dropdown.optionsData.map((item) => item.id)).toEqual([3]);
		dropdown.term.setValue('');
		expect(dropdown.optionsData).toHaveLength(2);
	});

	it('reads items without a child list', () => {
		const { dropdown } = render({ options: [{ id: 1, name: 'Plain' }], subArrayKey: 'none' });
		dropdown.term.setValue('plain');
		expect(dropdown.optionsData).toHaveLength(1);
	});
});

describe('AdvancedDropdown navigation', () => {
	it('opens at the bottom, or above', () => {
		const down = render();
		down.dropdown.toggleDropdown(new Event('click'));
		expect(down.dropdown.isOpen).toBe(true);
		const panel = (fixture: typeof down.fixture) =>
			(fixture.nativeElement as HTMLElement).querySelector('.dropdown-open') as HTMLElement;
		expect(panel(down.fixture).style.top).toBe('100%');
		const up = render({ position: 'top' });
		up.dropdown.toggleDropdown(new Event('click'));
		expect(panel(up.fixture).style.bottom).toBe('100%');
	});

	it('walks into a branch and back', () => {
		const { dropdown } = render();
		const branch = options()[0]!;
		dropdown.subItemClicked(branch);
		expect(dropdown.breadCrumbValues).toEqual([branch]);
		expect(dropdown.optionsData).toBe(branch.subcategories);
		dropdown.changeTo(branch);
		expect(dropdown.breadCrumbValues).toEqual([branch]);
		dropdown.clearOptions();
		expect(dropdown.breadCrumbValues).toEqual([]);
	});

	it('stays put on a leaf, and without a child key', () => {
		const { dropdown } = render();
		dropdown.subItemClicked({ id: 9, subcategories: [] });
		expect(dropdown.breadCrumbValues).toEqual([]);
		const flat = render({ subArrayKey: '' });
		flat.dropdown.changeTo({ id: 9 });
		expect(flat.dropdown.optionsData).toHaveLength(3);
	});

	it('closes on an outside click and removes a pill', () => {
		const { dropdown, seen } = render({ selectedOption: [3] });
		dropdown.isOpen = true;
		dropdown.clickOutside();
		expect(dropdown.isOpen).toBe(false);
		dropdown.removeItem(dropdown.selectedPills[0]);
		expect(dropdown.selectedIds).toEqual([]);
		expect(seen.at(-1)).toEqual([]);
	});
});

describe('DropdownList', () => {
	it('toggles an item and passes arrow clicks up', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(DropdownList, { set: { imports: [], template: '' } });
		const list = TestBed.createComponent(DropdownList).componentInstance;
		const selected: unknown[] = [];
		const opened: unknown[] = [];
		list.selected.subscribe((value) => selected.push(value));
		list.subItemClicked.subscribe((value) => opened.push(value));
		const item = { id: 1, selected: false };
		list.select(item);
		expect(item.selected).toBe(true);
		expect(selected).toEqual([item]);
		const event = new Event('click');
		list.onArrowClick(event, item);
		expect(opened).toEqual([item]);
	});
});
