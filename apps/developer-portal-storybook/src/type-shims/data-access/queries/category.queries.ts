import { signal } from '@angular/core';

import categoryFixture from '../../../../../storefront/public/assets/data/category.json';
import type {
	ICategory,
	ICategoryModel,
} from '../../../../../storefront/src/app/data-access/interfaces/category.interface';

const categories = structuredClone(categoryFixture.data.slice(0, 12)) as unknown as ICategory[];
const categoryPage: ICategoryModel = {
	data: categories,
	total: categories.length,
};

export function injectCategoriesQuery() {
	return {
		data: signal<ICategoryModel | undefined>(categoryPage),
		isFetching: signal(false),
		isPending: signal(false),
	};
}
