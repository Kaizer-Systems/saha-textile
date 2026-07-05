import { Component, input } from '@angular/core';

import { Category } from '../category';

@Component({
	selector: 'app-edit-category',
	templateUrl: './edit-category.html',
	styleUrls: ['./edit-category.scss'],
	imports: [Category],
})
export class EditCategory {
	readonly categoryType = input<string>('product');
}
