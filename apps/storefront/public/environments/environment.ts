import type { RuntimeConfig } from '../../src/app/core/config/runtime-config';

export const environment = {
	production: false,
	apiUrl: '',
	assetsDataUrl: '',
	siteUrl: '',
	/** @deprecated Alias for assetsDataUrl retained for existing data-access services. */
	URL: '',
	baseURL: '',
};

export function applyRuntimeConfig(config: RuntimeConfig): void {
	environment.production = config.production;
	environment.apiUrl = config.apiUrl;
	environment.assetsDataUrl = config.assetsDataUrl;
	environment.siteUrl = config.siteUrl;
	environment.URL = config.assetsDataUrl;
	environment.baseURL = config.siteUrl.endsWith('/') ? config.siteUrl : `${config.siteUrl}/`;
}
