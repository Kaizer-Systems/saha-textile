import { Component, input } from '@angular/core';

import { OwlOptions } from 'ngx-owl-carousel-o';

import { Categories } from '@shared/ui/categories/categories';

@Component({
	selector: 'app-collection-categories',
	templateUrl: './collection-categories.html',
	styleUrls: ['./collection-categories.scss'],
	imports: [Categories],
})
export class CollectionCategories {
	readonly style = input<string>('vertical');
	readonly image = input<string>();
	readonly theme = input<string>();
	readonly title = input<string>();
	readonly sliderOption = input<OwlOptions>();

	constructor() {}
}
