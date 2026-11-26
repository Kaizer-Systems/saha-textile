import type { Plugin } from 'vite';

/**
 * The page's application scripts at low fetch priority (the Fetch Priority API, web.dev "Optimize resource loading
 * with the Fetch Priority API": lower the priority of scripts the first paint does not need).
 *
 * Every shop page is drawn by the server, so its words, pictures and links are on screen before any script runs;
 * the scripts hydrate it afterwards (Angular's event replay keeps a tap made before then). Vite links the entry as
 * `<script type="module">` and every chunk it imports as `<link rel="modulepreload">`, both fetched at high priority,
 * so on a phone's line about 430 KB of scripts shared the bandwidth with the page's first picture and styles.
 * At low priority the browser gives the first picture, the stylesheets and the preloaded fonts the line first and
 * fetches the scripts straight after; Chrome gives an `async` script the same low priority by default. Measured on
 * the builder Home (Lighthouse phone): first paint 4.2 s -> 1.0 s, Speed Index 4.2 s -> 1.8 s.
 */
export function lowPriorityScripts(html: string): string {
	return html
		.replace(/<link\b(?=[^>]*\brel=["']?modulepreload\b)(?![^>]*\bfetchpriority=)/gi, '<link fetchpriority="low"')
		.replace(
			/<script\b(?=[^>]*\btype=["']?module\b)(?=[^>]*\bsrc=)(?![^>]*\bfetchpriority=)/gi,
			'<script fetchpriority="low"',
		);
}

/** Applies `lowPriorityScripts` to the built index.html, after Vite has added its script and preload tags. */
export function scriptPriorityPlugin(): Plugin {
	return {
		name: 'saha-textile:script-priority',
		apply: 'build',
		transformIndexHtml: { order: 'post', handler: lowPriorityScripts },
	};
}
