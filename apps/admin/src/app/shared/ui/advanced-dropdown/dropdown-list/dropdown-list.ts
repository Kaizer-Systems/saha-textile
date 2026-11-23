import { Component, computed, input, output } from '@angular/core';

import { TranslocoPipe } from '@jsverse/transloco';

import { childrenOf, type DropdownOption, labelOf } from '../dropdown-option';

@Component({
	selector: 'app-dropdown-list',
	templateUrl: './dropdown-list.html',
	styleUrls: ['./dropdown-list.scss'],
	imports: [TranslocoPipe],
})
export class DropdownList<T extends DropdownOption = DropdownOption> {
	readonly data = input.required<T>();
	readonly selectedPillIds = input<readonly unknown[]>([]);
	readonly key = input<string>('');
	readonly subArrayKey = input<string>('');

	readonly selected = output<T>();
	readonly subItemClicked = output<T>();

	readonly label = computed(() => labelOf(this.data(), this.key()));
	readonly hasChildren = computed(() => childrenOf(this.data(), this.subArrayKey()).length > 0);

	select(data: T) {
		data.selected = !data.selected;
		this.selected.emit(data);
	}

	onArrowClick(event: Event, data: T) {
		event.stopPropagation();
		this.subItemClicked.emit(data);
	}
}
