import { environment } from '../../public/environments/environment';

/**
 * The API address for Nitro handlers. They never run Angular's app initializer, so the shared
 * `environment` keeps its localhost default there; they read the deployment's config themselves.
 * No TypeScript-only syntax, because middleware imports this.
 */
export function serverApiUrl() {
	try {
		const apiUrl = JSON.parse(process.env['SAHA_TEXTILE_PUBLIC_CONFIG'] || '{}').apiUrl;
		if (typeof apiUrl === 'string' && apiUrl) return apiUrl;
	} catch {
		// A broken value: the storefront's own start-up check reports it.
	}
	return environment.apiUrl;
}
