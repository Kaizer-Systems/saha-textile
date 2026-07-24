/** A CMS-style static content page (privacy policy, terms, etc.) served from
 *  assets/data/pages/<slug>.json. `content` is trusted rich HTML rendered via
 *  [innerHTML] into the theme's `.ckeditor-content` wrapper. */
export interface IStaticPage {
	title: string;
	content: string;
}
