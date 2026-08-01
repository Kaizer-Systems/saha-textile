/**
 * NEXT-GEN-UI · Storybook manager adapter
 * What: Storybook manager theme composition and canonical child return control.
 * Why: the React-owned manager is separate from Angular previews but must share
 * portal identity and retain a route back to its Docusaurus gateway.
 * How: Storybook owns its toolbar DOM; a small observer mounts one dependency-free
 * return anchor into the right-hand tool group while shared tokens theme the shell.
 * Tuning knobs: gateway label and manager.css toolbar treatment.
 */

import { addons } from 'storybook/manager-api';

import '../../developer-portal/src/css/nextgen-theme.css';
import './manager.css';
import { createPortalStorybookTheme } from './portal-theme';

document.documentElement.dataset.portalTheme = 'dark';

const mountGatewayControl = (): void => {
	const toolbar = document.querySelector<HTMLElement>('[data-testid="sb-preview-toolbar"]');
	const toolGroups = toolbar?.lastElementChild?.children;
	const rightTools = toolGroups?.item(toolGroups.length - 1);
	if (!rightTools || rightTools.querySelector('.portal-storybook-gateway')) return;

	const gateway = document.createElement('a');
	gateway.className = 'portal-storybook-gateway';
	gateway.href = '/tools/storybook';
	gateway.setAttribute('aria-label', 'Return to the Storybook gateway');
	gateway.textContent = 'Return to gateway';
	rightTools.prepend(gateway);
};

const gatewayObserver = new MutationObserver(mountGatewayControl);
gatewayObserver.observe(document.body, { childList: true, subtree: true });
mountGatewayControl();

addons.setConfig({
	theme: createPortalStorybookTheme(),
});
