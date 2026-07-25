/* ============================================================================
 * NEXT-GEN-UI · Portal search index plugin (makes ⌘K fully dynamic)
 * ----------------------------------------------------------------------------
 * A build-time Docusaurus plugin that walks the docs tree, reads each page's
 * frontmatter, and publishes a search index into global data. The ⌘K command
 * palette reads it via usePluginData('portal-search-plugin') — so ANY new page
 * appears in search automatically, with NO code change to a central index.
 *
 * A page can enrich its own search terms with a `search_keywords: '...'`
 * frontmatter field (optional). Route + section are derived the same way
 * Docusaurus routes docs (routeBasePath '/'), so links stay correct.
 * ========================================================================= */

const path = require('path');

const { collectDocumentationPages } = require('../portal-data/compiler');

const SECTION_OVERRIDES = {
	api: 'API',
	adrs: 'ADRs',
	'getting-started': 'Start',
	'business-flows': 'Journeys',
};

function humanizeSegment(segment) {
	if (SECTION_OVERRIDES[segment]) return SECTION_OVERRIDES[segment];
	return segment
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}
function toSection(relPath) {
	const parts = relPath.split(/[\\/]/);
	if (parts.length < 2) return 'Portal'; // root-level page
	return humanizeSegment(parts[0]);
}

module.exports = function portalSearchPlugin(context) {
	return {
		name: 'portal-search-plugin',
		async loadContent() {
			const repositoryRoot = path.resolve(context.siteDir, '..', '..');
			const pages = collectDocumentationPages(repositoryRoot);

			const index = [];
			for (const page of pages) {
				const fm = page.frontMatter;
				if (!fm.title) continue; // needs a human title to be useful
				index.push({
					title: fm.title,
					path: page.route,
					section: toSection(page.relativePath),
					keywords: [fm.description, fm.search_keywords].filter(Boolean).join(' '),
				});
			}
			// Stable order: section, then title.
			index.sort((a, b) => a.section.localeCompare(b.section) || a.title.localeCompare(b.title));
			return index;
		},
		async contentLoaded({ content, actions }) {
			actions.setGlobalData({ index: content });
		},
	};
};
