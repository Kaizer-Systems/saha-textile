import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

import { API_TAG_DESCRIPTIONS } from './openapi-tags';

/**
 * The local server the document advertises.
 *
 * HTTPS, and `localhost` rather than `127.0.0.1`, because this document describes a session
 * carried by `__Host-`-prefixed cookies. That prefix requires `Secure`, so a plain-HTTP origin can
 * never send one — and the prefix also forbids a `Domain` attribute, which host-locks the cookie,
 * so a reader signed in at `localhost` would not have it sent to `127.0.0.1` either. The previous
 * value failed on both counts: Scalar's "Test Request" could reach the API and still never
 * authenticate, with nothing on screen explaining why.
 *
 * Matches `.claude/launch.json` and the storefront's `apiUrl`, so the address in the docs is the
 * address everything else uses.
 */
const DEFAULT_DOCUMENTATION_SERVER = 'https://localhost:4000';

/**
 * The session cookie a browser presents. Named here rather than imported from
 * `common/cookies` because that resolves the `__Host-` prefix from runtime configuration,
 * and a published contract must not change shape depending on which environment generated it.
 * The prefixed spelling is described in the scheme text instead.
 */
const SESSION_COOKIE_SCHEME = 'sessionCookie';

export function createOpenApiDocument(app: INestApplication, serverUrl = DEFAULT_DOCUMENTATION_SERVER): OpenAPIObject {
	const builder = new DocumentBuilder()
		.setTitle('Saha Textile API')
		.setDescription(
			[
				'Storefront + admin API (catalog, cart, orders, currency, promotions, auth).',
				'Contract status: scaffolded. Undocumented schemas and security semantics remain implementation debt.',
			].join(' '),
		)
		.setVersion('0.1.0')
		.addServer(serverUrl, 'Approved local development')
		/**
		 * Cookie, not bearer. The document previously advertised `addBearerAuth()`, which
		 * described an authentication method this API does not accept — the guard that read
		 * `Authorization: Bearer` was retired in auth pass 4a, and `e2e/session-rotation.mjs`
		 * asserts that a valid access token offered as a bearer header authenticates nothing.
		 * A contract that documents a scheme the server rejects sends every integrator down a
		 * path that cannot work.
		 */
		.addCookieAuth(
			'st_access',
			{
				type: 'apiKey',
				in: 'cookie',
				name: 'st_access',
				description: [
					'httpOnly session cookie set by the API. It is never returned in a response body and cannot be read by client script.',
					'Served as `__Host-st_access` wherever the response is HTTPS with no pinned cookie domain.',
					'Unsafe methods additionally require the readable double-submit half echoed as the `x-csrf-token` header.',
				].join(' '),
			},
			SESSION_COOKIE_SCHEME,
		);

	for (const tag of API_TAG_DESCRIPTIONS) builder.addTag(tag.name, tag.description);

	const document = SwaggerModule.createDocument(app, builder.build());
	return Object.assign(document, {
		'x-saha-textile-contract-status': 'scaffolded',
		'x-saha-textile-test-request-policy':
			'Normal CORS, authentication, CSRF, authorization, ownership, and rate-limit controls always apply.',
	});
}
