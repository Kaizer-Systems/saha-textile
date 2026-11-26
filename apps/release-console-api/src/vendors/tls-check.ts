import { connect } from 'node:tls';

/** What a hostname answers on 443: its certificate's issuer and expiry, or why it did not answer. */
export interface HostCertificate {
	ok: boolean;
	issuer: string;
	expiresOn: string | null;
	error: string;
}

/**
 * A direct TLS handshake with `host:443` (brief 26gq3NbcbBESea6abRtsa3, screen 9): the certificate the
 * world sees, checked by the system's trust store. Free, and nothing is sent beyond the handshake.
 */
export function checkHost(host: string, timeoutMs = 8000): Promise<HostCertificate> {
	return new Promise((resolve) => {
		const socket = connect({ host, port: 443, servername: host, timeout: timeoutMs }, () => {
			const cert = socket.getPeerCertificate();
			const issuer = String(cert?.issuer?.O ?? cert?.issuer?.CN ?? '');
			const expiresOn = cert?.valid_to ? new Date(cert.valid_to).toISOString() : null;
			resolve({
				ok: socket.authorized,
				issuer,
				expiresOn,
				error: socket.authorized ? '' : String(socket.authorizationError ?? ''),
			});
			socket.end();
		});
		socket.on('timeout', () => {
			resolve({ ok: false, issuer: '', expiresOn: null, error: 'no answer within 8 s' });
			socket.destroy();
		});
		socket.on('error', (e) => resolve({ ok: false, issuer: '', expiresOn: null, error: e.message }));
	});
}
