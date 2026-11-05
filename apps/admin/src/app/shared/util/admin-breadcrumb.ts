export interface AdminCrumb {
	label: string;
}

/** Admin crumbs. Separate from the storefront breadcrumb helper. */
export function adminBreadcrumb(labels: readonly string[]): AdminCrumb[] {
	return labels.map((label) => ({ label }));
}
