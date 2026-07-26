import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
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
