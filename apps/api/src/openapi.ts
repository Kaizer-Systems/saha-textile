import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

const DEFAULT_DOCUMENTATION_SERVER = 'http://127.0.0.1:4000';

export function createOpenApiDocument(app: INestApplication, serverUrl = DEFAULT_DOCUMENTATION_SERVER): OpenAPIObject {
	const configuration = new DocumentBuilder()
		.setTitle('Saha Textile API')
		.setDescription(
			[
				'Storefront + admin API (catalog, cart, orders, currency, promotions, auth).',
				'Contract status: scaffolded. Undocumented schemas and security semantics remain implementation debt.',
			].join(' '),
		)
		.setVersion('0.1.0')
		.addServer(serverUrl, 'Approved local development')
		.addBearerAuth()
		.build();

	const document = SwaggerModule.createDocument(app, configuration);
	return Object.assign(document, {
		'x-saha-textile-contract-status': 'scaffolded',
		'x-saha-textile-test-request-policy':
			'Normal CORS, authentication, CSRF, authorization, ownership, and rate-limit controls always apply.',
	});
}
