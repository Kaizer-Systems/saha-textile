import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';

import { ClickOutsideDirective } from '@shared/directives/out-side-directive';

import { DropdownList } from './dropdown-list/dropdown-list';
import { childrenOf, type DropdownOption, type DropdownOptionId, labelOf } from './dropdown-option';

@Component({
	selector: 'app-advanced-dropdown',
	templateUrl: './advanced-dropdown.html',
	styleUrls: ['./advanced-dropdown.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [ClickOutsideDirective, ReactiveFormsModule, DropdownList, TranslocoModule],
})
export class AdvancedDropdown<T extends DropdownOption> {
	readonly dropdownContainer = viewChild.required<ElementRef>('dropdownContainer');
	readonly toggleButton = viewChild<ElementRef>('toggleButton');
	readonly items = viewChild<ElementRef>('items');

	readonly selectSingle = input<boolean>(false);
	readonly displayKey = input<string>('name');
	readonly subArrayKey = input<string>('');
	readonly options = input<readonly T[]>([]);
	/** The ids already chosen; compared as text. */
	readonly selectedOption = input<readonly unknown[]>([]);
	readonly position = input<string>('bottom');

	readonly selectedItem = output<DropdownOptionId<T>[]>();

	public isOpen = false;
	public optionsData: readonly T[] = [];
	public selectedPills: T[] = [];
	public selectedIds: DropdownOptionId<T>[] = [];
	public breadCrumbValues: T[] = [];
	public term = new FormControl('');

	constructor() {
		this.term.valueChanges.subscribe((data) => {
			if (data) {
				const term = data.toLowerCase();
				this.optionsData = this.options().filter((item) => this.hasValue(item, term));
			} else {
				this.optionsData = this.options();
			}
		});
	}

	ngOnChanges() {
		this.optionsData = this.options();
		this.selectedPills = [];
		this.selectedIds = [];
		const selectedOption = this.selectedOption();
		if (selectedOption?.length) {
			this.getSelectedData(selectedOption);
		} else {
			this.selectedPills = [];
			this.selectedIds = [];
		}
	}

	/** Ids are compared as text: the catalogue's ids are words such as `cat_2051`, not numbers. */
	getSelectedData(value: readonly unknown[]) {
		const ids = value.map((x) => String(x));
		this.options().forEach((item) => this.recursiveSelected(item, ids));
	}

	recursiveSelected(item: T, value: readonly string[]) {
		if (item.id && value.includes(String(item.id))) {
			this.onSelect(item);
		}
		this.children(item).forEach((child) => this.recursiveSelected(child, value));
	}

	/** A row matches the search (`term`, lower case) when its label does, or any row under it. */
	hasValue(item: T, term: string): boolean {
		return (
			this.label(item).toLowerCase().includes(term) ||
			this.children(item).some((child) => this.hasValue(child, term))
		);
	}

	label(item: T): string {
		return labelOf(item, this.displayKey());
	}

	children(item: T): T[] {
		return childrenOf(item, this.subArrayKey());
	}

	toggleDropdown(_event: Event) {
		this.isOpen = !this.isOpen;
		let selector = this.dropdownContainer().nativeElement.querySelector('.dropdown-open');
		if (this.position() == 'bottom') {
			selector.style.bottom = 'auto';
			selector.style.top = '100%';
		} else {
			selector.style.bottom = '100%';
			selector.style.top = 'auto';
		}
	}

	onSelect(data: T) {
		if (this.selectSingle()) {
			this.selectedPills = [];
			this.selectedIds = [];
			this.selectedPills.push(data);
			this.selectedIds.push(data.id as DropdownOptionId<T>);
		} else if (this.selectedPills.indexOf(data) < 0) {
			this.selectedPills.push(data);
			this.selectedIds.push(data.id as DropdownOptionId<T>);
		} else {
			if (!data.selected) {
				this.removeItem(data);
			}
		}

		this.selectedItem.emit(this.selectedIds);
	}

	removeItem(data: T) {
		this.selectedPills.splice(this.selectedPills.indexOf(data), 1);
		this.selectedIds.splice(this.selectedIds.indexOf(data.id as DropdownOptionId<T>), 1);
		this.selectedItem.emit(this.selectedIds);
	}

	subItemClicked(data: T) {
		this.isOpen = true;
		const children = this.children(data);
		if (!children.length) return;
		this.breadCrumbValues.push(data);
		this.optionsData = children;
	}

	changeTo(data: T) {
		const subArrayKey = this.subArrayKey();
		if (subArrayKey) {
			this.optionsData = this.children(data);
			this.breadCrumbValues.splice(
				this.breadCrumbValues.indexOf(data) + 1,
				this.breadCrumbValues.length - this.breadCrumbValues.indexOf(data),
			);
		}
	}

	clearOptions() {
		this.optionsData = this.options();
		this.breadCrumbValues = [];
	}

	clickOutside(): void {
		this.isOpen = false;
	}
}
