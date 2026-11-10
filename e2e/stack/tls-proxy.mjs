import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

/**
 * Puts the production storefront behind https://localhost:4200, the only shop origin the API's
 * CORS list allows. Usage: node e2e/stack/tls-proxy.mjs <key.pem> <cert.pem> <target port> [listen port].
 * The listen port defaults to 4200; another one serves a second copy beside the local servers.
 */
const [keyPath, certPath, targetPort, listenPort = '4200'] = process.argv.slice(2);

https
	.createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (request, response) => {
		const upstream = http.request(
			{
				host: '127.0.0.1',
				port: Number(targetPort),
				path: request.url,
				method: request.method,
				headers: { ...request.headers, host: `localhost:${listenPort}`, 'x-forwarded-proto': 'https' },
			},
			(answer) => {
				response.writeHead(answer.statusCode ?? 502, answer.headers);
				answer.pipe(response);
			},
		);
		upstream.on('error', () => {
			response.writeHead(502);
			response.end();
		});
		request.pipe(upstream);
	})
	.listen(Number(listenPort), '127.0.0.1');
