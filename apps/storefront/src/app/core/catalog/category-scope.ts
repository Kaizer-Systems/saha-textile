import { ICategory } from '@data-access/interfaces/category.interface';

/** The category a collection page is showing. A second placement keeps its slug, so it still matches. */
function currentCategory(all: readonly ICategory[], path: string): ICategory | undefined {
	const slug = path.split('/').at(-1);
	return all.find((row) => row.canonical_path === path) ?? all.find((row) => row.slug === slug);
}

const topLevel = (all: readonly ICategory[]): ICategory[] => all.filter((row) => !row.parent_id);

/** One level down from a collection page: the shop's top categories on the plain collections page. */
export function childCategories(all: readonly ICategory[], path: string | undefined): ICategory[] {
	const current = path ? currentCategory(all, path) : undefined;
	return current ? all.filter((row) => row.parent_id === current.id) : topLevel(all);
}

/** What to browse next: the children, or on a last-level page the categories beside it. */
export function browseCategories(all: readonly ICategory[], path: string | undefined): ICategory[] {
	const children = childCategories(all, path);
	if (children.length) return children;
	const current = path ? currentCategory(all, path) : undefined;
	return all.filter((row) => row.parent_id === current?.parent_id);
}
