import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { DropdownList } from './dropdown-list';

interface Row {
	id: string;
	name: string;
	subcategories?: Row[];
}

describe('DropdownList', () => {
	const render = (data: Row) => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(DropdownList, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent<DropdownList<Row>>(DropdownList);
		fixture.componentRef.setInput('data', data);
		fixture.componentRef.setInput('key', 'name');
		fixture.componentRef.setInput('subArrayKey', 'subcategories');
		return fixture.componentInstance;
	};

	it('shows the row’s label, and an arrow only when it has rows under it', () => {
		const branch = render({ id: 'c1', name: 'Sarees', subcategories: [{ id: 'c2', name: 'Silk' }] });
		expect(branch.label()).toBe('Sarees');
		expect(branch.hasChildren()).toBe(true);
		const leaf = render({ id: 'c2', name: 'Silk', subcategories: [] });
		expect(leaf.hasChildren()).toBe(false);
	});
});
