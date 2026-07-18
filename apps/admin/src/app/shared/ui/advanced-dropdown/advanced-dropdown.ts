import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';

import { ClickOutsideDirective } from '@shared/directives/out-side-directive';

import { DropdownList } from './dropdown-list/dropdown-list';

@Component({
	selector: 'app-advanced-dropdown',
	templateUrl: './advanced-dropdown.html',
	styleUrls: ['./advanced-dropdown.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [ClickOutsideDirective, ReactiveFormsModule, DropdownList, TranslocoModule],
})
export class AdvancedDropdown {
	readonly dropdownContainer = viewChild<ElementRef>('dropdownContainer');
	readonly toggleButton = viewChild<ElementRef>('toggleButton');
	readonly items = viewChild<ElementRef>('items');

	readonly selectSingle = input<boolean>(false);
	readonly displayKey = input<string>('name');
	readonly subArrayKey = input<string>(undefined);
	readonly options = input<any[]>(undefined);
	readonly selectedOption = input<any[]>(undefined);
	readonly position = input<string>('bottom');

	readonly selectedItem = output<any>();

	public isOpen = false;
	public optionsData: any[] = [];
	public selectedPills: any[] = [];
	public selectedIds: number[] = [];
	public breadCrumbValues: any[] = [];
	public term = new FormControl('');

	constructor() {
		this.term.valueChanges.subscribe((data: any) => {
			if (data) {
				this.optionsData = [];
				this.options().forEach((item) => {
					this.hasValue(item) && this.optionsData.push(item);
				});
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

	getSelectedData(value: any) {
		this.options().forEach((item) => {
			this.recursiveSelected(
				item,
				value.map(function (x: any) {
					return parseInt(x);
				}),
			);
		});
	}

	recursiveSelected(item: any, value: any) {
		if (item.id && value.includes(item.id)) {
			this.onSelect(item);
		}
		if (item[this.subArrayKey()]?.length) {
			item[this.subArrayKey()].forEach((child: any) => {
				this.recursiveSelected(child, value);
			});
		}
	}

	hasValue(item: any) {
		let valueToReturn = false;
		if (item[this.displayKey()].toLowerCase().includes(this.term?.value?.toLowerCase())) {
			valueToReturn = true;
		}
		item[this.subArrayKey()]?.length &&
			item[this.subArrayKey()].forEach((child: any) => {
				if (this.hasValue(child)) {
					valueToReturn = true;
				}
			});
		return valueToReturn;
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

	onSelect(data: any) {
		if (this.selectSingle()) {
			this.selectedPills = [];
			this.selectedIds = [];
			this.selectedPills.push(data);
			this.selectedIds.push(data.id);
		} else if (this.selectedPills.indexOf(data) < 0) {
			this.selectedPills.push(data);
			this.selectedIds.push(data.id);
		} else {
			if (!data.selected) {
				this.removeItem(data);
			}
		}

		this.selectedItem.emit(this.selectedIds);
	}

	removeItem(data: any) {
		this.selectedPills.splice(this.selectedPills.indexOf(data), 1);
		this.selectedIds.splice(this.selectedIds.indexOf(data.id), 1);
		this.selectedItem.emit(this.selectedIds);
	}

	subItemClicked(data: any) {
		this.isOpen = true;
		data[this.subArrayKey()]?.length && this.breadCrumbValues.push(data);
		data[this.subArrayKey()]?.length && (this.optionsData = data[this.subArrayKey()]);
	}

	changeTo(data: any) {
		const subArrayKey = this.subArrayKey();
		if (subArrayKey) {
			this.optionsData = data[subArrayKey];
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
