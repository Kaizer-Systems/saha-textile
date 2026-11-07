import { ICategory } from '@data-access/interfaces/category.interface';

/** Theme settings still name seeded categories by their demo number. */
export const isConfiguredCategory = (category: ICategory, ids: readonly (number | string)[]): boolean =>
	ids.some((id) => category.id === id || category.id === `cat_${id}`);
