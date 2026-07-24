export interface RuntimeConfig {
	production: boolean;
	apiUrl: string;
	/** Mock/static JSON base used by current data-access services (assets/data). */
	assetsDataUrl: string;
	siteUrl: string;
	defaultLocale?: string;
	supportedLocales?: string[];
}

function isRuntimeConfig(value: unknown): value is RuntimeConfig {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const config = value as Record<string, unknown>;
	return (
		typeof config['production'] === 'boolean' &&
		typeof config['apiUrl'] === 'string' &&
		typeof config['assetsDataUrl'] === 'string' &&
		typeof config['siteUrl'] === 'string' &&
		(config['defaultLocale'] === undefined || typeof config['defaultLocale'] === 'string') &&
		(config['supportedLocales'] === undefined ||
			(Array.isArray(config['supportedLocales']) && config['supportedLocales'].every((locale) => typeof locale === 'string')))
	);
}

async function readServerRuntimeConfig(): Promise<unknown> {
	const [{ readFile }, { join }] = await Promise.all([
		import(/* @vite-ignore */ 'node:fs/promises'),
		import(/* @vite-ignore */ 'node:path'),
	]);
	const configJson = await readFile(join(process.cwd(), 'public', 'config.json'), 'utf8');
	return JSON.parse(configJson) as unknown;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
	let config: unknown;

	try {
		const response = await fetch('/config.json', { cache: 'no-store' });
		if (!response.ok) {
			throw new Error(`Unable to load runtime config: ${response.status} ${response.statusText}`);
		}
		config = (await response.json()) as unknown;
	} catch (error: unknown) {
		if (typeof window !== 'undefined') {
			throw error;
		}

		// Kept for parity with the storefront's Analog SSR-compatible config seam.
		config = await readServerRuntimeConfig();
	}

	if (!isRuntimeConfig(config)) {
		throw new Error('Runtime config is invalid.');
	}

	return config;
}
