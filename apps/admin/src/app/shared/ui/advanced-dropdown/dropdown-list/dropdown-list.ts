import { Component, output, input } from '@angular/core';

@Component({
	selector: 'app-dropdown-list',
	templateUrl: './dropdown-list.html',
	styleUrls: ['./dropdown-list.scss'],
	imports: [],
})
export class DropdownList {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly data = input<any>(undefined);
	readonly selectedPillIds = input<number[]>(undefined);
	readonly key = input<string>(undefined);
	readonly subArrayKey = input<string>(undefined);

	readonly selected = output<any>();
	readonly subItemClicked = output<any>();

	select(data: any) {
		data.selected = !data.selected;
		this.selected.emit(data);
	}

	onArrowClick(event: Event, data: any) {
		event.stopPropagation();
		this.subItemClicked.emit(data);
	}
}
