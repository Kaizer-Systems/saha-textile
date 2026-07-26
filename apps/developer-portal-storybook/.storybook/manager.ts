/**
 * NEXT-GEN-UI · Storybook manager adapter
 * The manager is Storybook-owned React UI, separate from Angular previews. It
 * therefore receives a native Storybook theme plus the shared portable portal
 * token contract; no Docusaurus layout selectors are imported.
 */

import { addons } from 'storybook/manager-api';

import '../../developer-portal/src/css/nextgen-theme.css';
import './manager.css';
import { createPortalStorybookTheme } from './portal-theme';

document.documentElement.dataset.portalTheme = 'dark';

addons.setConfig({
	theme: createPortalStorybookTheme(),
});
