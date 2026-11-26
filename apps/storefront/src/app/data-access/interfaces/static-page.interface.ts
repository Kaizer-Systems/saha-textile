/** A CMS-style static content page (privacy policy, terms, etc.) served from
 *  the API (`GET /catalog/pages/:slug`), written in Admin › Pages. `content` is trusted rich HTML rendered via
 *  [innerHTML] into the theme's `.ckeditor-content` wrapper. */
export interface IStaticPage {
	title: string;
	content: string;
	/** Legal pages (Legal Pages brief): the last save, shown as “Last updated”; the search title and description. */
	updatedAt?: string;
	metaTitle?: string;
	metaDescription?: string;
}
