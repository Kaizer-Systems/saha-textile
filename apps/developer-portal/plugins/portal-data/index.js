/* ============================================================================
 * NEXT-GEN-UI · Governed portal-data Docusaurus plugin
 * ----------------------------------------------------------------------------
 * Compiles the versioned docs/_data manifest plus KB truth at build time, then
 * publishes only validated datasets through Docusaurus global data. Wave-1 and
 * future instruments consume this plugin; component files contain no project
 * status facts. Tuning belongs in compiler.js and docs/_data, never here.
 * ========================================================================= */

const path = require('path');

const { compilePortalData } = require('./compiler');

module.exports = function portalDataPlugin(context) {
	return {
		name: 'portal-data-plugin',
		async loadContent() {
			const repositoryRoot = path.resolve(context.siteDir, '..', '..');
			return compilePortalData({ repositoryRoot });
		},
		async contentLoaded({ content, actions }) {
			actions.setGlobalData(content);
		},
	};
};
