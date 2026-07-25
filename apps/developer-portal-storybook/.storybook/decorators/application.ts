import type { Decorator } from '@storybook/angular';

import { adminDecorator } from './admin';
import { sharedDecorator } from './shared';
import { storefrontDecorator } from './storefront';

export type StorybookApplication = 'storefront' | 'admin' | 'shared';

const decorators: Record<StorybookApplication, Decorator> = {
	storefront: storefrontDecorator,
	admin: adminDecorator,
	shared: sharedDecorator,
};

const applicationStyles: Partial<Record<StorybookApplication, string>> = {
	storefront: 'storefront.css',
	admin: 'admin.css',
};

function isStorybookApplication(value: unknown): value is StorybookApplication {
	return value === 'storefront' || value === 'admin' || value === 'shared';
}

function selectApplicationStyles(application: StorybookApplication) {
	for (const [candidate, filename] of Object.entries(applicationStyles)) {
		const id = `storybook-${candidate}-application-styles`;
		let link = document.querySelector<HTMLLinkElement>(`#${id}`);
		if (!link) {
			link = document.createElement('link');
			link.id = id;
			link.rel = 'stylesheet';
			link.href = new URL(`portal-application-styles/${filename}`, document.baseURI).href;
			document.head.append(link);
		}
		link.disabled = candidate !== application;
	}
}

export const applicationDecorator: Decorator = (story, context) => {
	const requestedApplication = context.parameters.application;
	const application = isStorybookApplication(requestedApplication) ? requestedApplication : 'shared';
	document.body.dataset.storybookApplication = application;
	selectApplicationStyles(application);
	return decorators[application](story, context);
};
