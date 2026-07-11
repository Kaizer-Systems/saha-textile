import { Component } from '@angular/core';

/**
 * Custom home page — served at `/` (the app's default route).
 *
 * This is a blank starter you build up by importing theme widgets and dropping
 * their markup into home.html (see the "build your homepage" guide). The global
 * header/footer/drawers come from Layout (rendered above the router in App), so
 * this component only owns the page BODY.
 *
 * As you add widgets:
 *   1. import the widget class here and add it to `imports`
 *   2. paste its `<app-…>` tag into home.html
 *   3. feed it data (a signal/const in this class, or a query) — see the guide
 */
@Component({
	selector: 'app-home',
	templateUrl: './home.html',
	styleUrls: ['./home.scss'],
	imports: [
		// Add theme widgets here as you compose the page, e.g.:
		// HomeBanner, Categorie, ThemeProduct, Deal, ImageLink, Newsletter, Blog
	],
})
export class Home {
	// Section data goes here. Two options per section (see the guide):
	//  • static: `public banner = { … }` shaped like the theme JSON slice, or
	//  • dynamic: a TanStack query (e.g. injectProductsQuery / injectHomePageQuery).
}
