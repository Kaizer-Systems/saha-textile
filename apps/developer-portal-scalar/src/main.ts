/**
 * NEXT-GEN-UI · Scalar child composition
 * What: mounts the generated OpenAPI reference with Scalar's required base CSS.
 * Why: the shared portal adapter can theme a complete Scalar UI, but cannot replace
 * Scalar's structural component stylesheet.
 * How: load vendor structure first, then shared tokens, then the local adapter.
 * Tuning knobs: Scalar configuration and adapter variables; no token values live here.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@scalar/api-reference/style.css';
import '../../developer-portal/src/css/nextgen-theme.css';
import './styles.css';

import { createApiReference } from '@scalar/api-reference';

createApiReference('#app', {
	url: '/api/openapi.json',
	theme: 'none',
	layout: 'modern',
	hideTestRequestButton: false,
	persistAuth: false,
	withDefaultFonts: false,
	darkMode: true,
});
