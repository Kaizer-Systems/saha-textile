import { Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';

import { ICategory } from '@data-access/interfaces/category.interface';
import { NoData } from '@shared/ui/no-data/no-data';

import { TreeNode } from './tree-node/tree-node';

@Component({
	selector: 'app-tree',
	templateUrl: './tree.html',
	styleUrls: ['./tree.scss'],
	imports: [ReactiveFormsModule, TreeNode, NoData, TranslocoModule],
})
export class Tree {
	readonly type = input<string>(undefined);
	readonly data = input<ICategory[]>(undefined);
	readonly recursionKey = input<string>(undefined);
	readonly displayKey = input<string>('name');
	readonly categoryType = input<string | null>('product');

	public treeSearch = new FormControl('');
	public dataToShow: ICategory[] = [];

	constructor() {
		this.treeSearch.valueChanges.subscribe((data) => {
			if (data) {
				this.dataToShow = [];
				this.data().forEach((item) => {
					this.hasValue(item) && this.dataToShow.push(item);
				});
			} else {
				this.dataToShow = this.data();
			}
		});
	}

	ngOnChanges() {
		this.dataToShow = this.data();
	}

	hasValue(item: ICategory) {
		let valueToReturn = false;
		if (item[this.displayKey()].toLowerCase().includes(this.treeSearch?.value?.toLowerCase())) {
			valueToReturn = true;
		}
		item[this.recursionKey()]?.length &&
			item[this.recursionKey()].forEach((child: ICategory) => {
				if (this.hasValue(child)) {
					valueToReturn = true;
				}
			});
		return valueToReturn;
	}
}
