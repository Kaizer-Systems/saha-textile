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

function stripFrontMatter(raw) {
	return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function cleanHeading(value) {
	return value
		.replace(/\s+\{#[^}]+}\s*$/, '')
		.replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
		.replace(/[`*_~]/g, '')
		.trim();
}

function headingAnchor(value) {
	return cleanHeading(value)
		.toLocaleLowerCase('en')
		.replace(/<[^>]+>/g, '')
		.replace(/[\[\](){}:;,.!?'"“”‘’]/g, '')
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.trim()
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-');
}

function searchableBody(value) {
	return value
		.replace(/\{\/\*[\s\S]*?\*\/}/g, ' ')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
		.replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
		.replace(/<[^>]+>/g, ' ')
		.replace(/[|#>*_~{}\[\]()-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 4000);
}

function liveContextHeadingEntries(page) {
	const body = stripFrontMatter(page.raw);
	const matches = [...body.matchAll(/^#{2,6}\s+(.+?)\s*#*\s*$/gm)];
	const anchorCounts = new Map();

	return matches.flatMap((match, index) => {
		const heading = cleanHeading(match[1]);
		const baseAnchor = headingAnchor(heading);
		if (!heading || !baseAnchor) return [];

		const occurrence = anchorCounts.get(baseAnchor) ?? 0;
		anchorCounts.set(baseAnchor, occurrence + 1);
		const anchor = occurrence === 0 ? baseAnchor : `${baseAnchor}-${occurrence}`;
		const sectionStart = (match.index ?? 0) + match[0].length;
		const sectionEnd = matches[index + 1]?.index ?? body.length;
		const sectionBody = searchableBody(body.slice(sectionStart, sectionEnd));

		return [
			{
				id: `${page.route}#${anchor}`,
				title: heading,
				path: `${page.route}#${anchor}`,
				section: 'Live Context',
				keywords: [page.frontMatter.title, page.frontMatter.search_keywords, sectionBody]
					.filter(Boolean)
					.join(' '),
				documentRole: 'canonical',
				kind: 'heading',
			},
		];
	});
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
					id: page.route,
					title: fm.title,
					path: page.route,
					section: toSection(page.relativePath),
					keywords: [
						fm.description,
						fm.search_keywords,
						fm.document_role === 'canonical' ? searchableBody(stripFrontMatter(page.raw)) : '',
					]
						.filter(Boolean)
						.join(' '),
					status: fm.status,
					documentRole: fm.document_role,
					kind: 'page',
				});
				if (fm.document_role === 'canonical') {
					index.push(...liveContextHeadingEntries(page));
				}
			}
			// Stable order: section, then title.
			index.sort((a, b) => a.section.localeCompare(b.section) || a.title.localeCompare(b.title));

			const liveDocuments = pages
				.filter((page) => page.frontMatter?.document_role === 'canonical')
				.map((page) => ({
					title: page.frontMatter.title,
					path: page.route,
					lastVerified: page.frontMatter.last_verified,
				}))
				.sort((left, right) => left.title.localeCompare(right.title));

			return {
				index,
				liveContext: {
					rootPath: '/engineering-live-context',
					generatedAt: new Date().toISOString(),
					documents: liveDocuments,
				},
			};
		},
		async contentLoaded({ content, actions }) {
			actions.setGlobalData(content);
		},
	};
};
