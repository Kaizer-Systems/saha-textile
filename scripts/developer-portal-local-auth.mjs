import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export const developerPortalSessionCookie = 'st_developer_portal_session';
export const developerPortalUsernameVariable = 'DEVELOPER_PORTAL_LOCAL_USERNAME';
export const developerPortalPasswordVariable = 'DEVELOPER_PORTAL_LOCAL_PASSWORD';

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const internalPortalPrefix = '/__portal/';

function normalizeHostname(hostname) {
	return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function credentialDigest(value) {
	return createHash('sha256').update(value, 'utf8').digest();
}

function constantTimeCredentialMatch(provided, expectedDigest) {
	const providedDigest = credentialDigest(typeof provided === 'string' ? provided : '');
	return timingSafeEqual(providedDigest, expectedDigest);
}

export function assertLoopbackHost(host) {
	if (!loopbackHosts.has(host)) {
		throw new Error(
			`The developer portal is local-only. Refusing non-loopback host "${host}"; use 127.0.0.1, localhost, or ::1.`,
		);
	}
}

export function formatPortalOrigin(host, port) {
	assertLoopbackHost(host);
	const hostname = host === '::1' ? `[${host}]` : host;
	return `http://${hostname}:${port}`;
}

export async function readDeveloperPortalCredentials({ environment, filePath }) {
	let fileValues = {};
	try {
		fileValues = parseEnv(await readFile(filePath, 'utf8'));
	} catch (error) {
		if (error?.code !== 'ENOENT') {
			throw error;
		}
	}

	const username = environment[developerPortalUsernameVariable] ?? fileValues[developerPortalUsernameVariable];
	const password = environment[developerPortalPasswordVariable] ?? fileValues[developerPortalPasswordVariable];

	if (!username || !password) {
		throw new Error(
			[
				'Developer portal local credentials are missing.',
				`Copy apps/developer-portal/.env.example to apps/developer-portal/.env.local and set ${developerPortalUsernameVariable} and ${developerPortalPasswordVariable}.`,
				'No default credential is provided, and this file must remain uncommitted.',
			].join(' '),
		);
	}

	return { username, password };
}

export function environmentWithoutDeveloperPortalCredentials(environment) {
	return Object.fromEntries(
		Object.entries(environment).filter(
			([key]) => key !== developerPortalUsernameVariable && key !== developerPortalPasswordVariable,
		),
	);
}

export function sanitizePortalReturnPath(value) {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
		return '/';
	}

	let parsed;
	try {
		parsed = new URL(value, 'http://developer-portal.local');
	} catch {
		return '/';
	}

	if (parsed.origin !== 'http://developer-portal.local' || parsed.pathname.startsWith(internalPortalPrefix)) {
		return '/';
	}

	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function parseRequestCookies(header) {
	if (!header) {
		return new Map();
	}

	return new Map(
		header
			.split(';')
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => {
				const separator = part.indexOf('=');
				if (separator === -1) {
					return [part, ''];
				}
				return [part.slice(0, separator), part.slice(separator + 1)];
			}),
	);
}

export function createDeveloperPortalLocalAuth({ username, password }) {
	const usernameDigest = credentialDigest(username);
	const passwordDigest = credentialDigest(password);
	const sessions = new Set();

	return {
		authenticate(providedUsername, providedPassword) {
			const usernameMatches = constantTimeCredentialMatch(providedUsername, usernameDigest);
			const passwordMatches = constantTimeCredentialMatch(providedPassword, passwordDigest);
			return usernameMatches && passwordMatches;
		},
		createSession() {
			const token = randomBytes(32).toString('base64url');
			sessions.add(token);
			return token;
		},
		hasSession(cookieHeader) {
			const token = parseRequestCookies(cookieHeader).get(developerPortalSessionCookie);
			return typeof token === 'string' && sessions.has(token);
		},
		destroySession(cookieHeader) {
			const token = parseRequestCookies(cookieHeader).get(developerPortalSessionCookie);
			if (typeof token !== 'string') {
				return false;
			}
			return sessions.delete(token);
		},
	};
}

export function createSessionCookie(token) {
	return `${developerPortalSessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

export function clearSessionCookie() {
	return `${developerPortalSessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export function hasExpectedPortalOrigin(request, portalOrigin) {
	const origin = request.headers.origin;
	const host = request.headers.host;
	if (typeof origin !== 'string' || typeof host !== 'string') {
		return false;
	}

	let expectedOrigin;
	let requestOrigin;
	let requestHost;
	try {
		expectedOrigin = new URL(portalOrigin);
		requestOrigin = new URL(origin);
		requestHost = new URL(`${expectedOrigin.protocol}//${host}`);
	} catch {
		return false;
	}

	const originHostname = normalizeHostname(requestOrigin.hostname);
	const hostHostname = normalizeHostname(requestHost.hostname);
	return (
		requestOrigin.protocol === expectedOrigin.protocol &&
		requestOrigin.port === expectedOrigin.port &&
		loopbackHosts.has(originHostname) &&
		loopbackHosts.has(hostHostname) &&
		requestOrigin.host === requestHost.host
	);
}

export async function readUrlEncodedBody(request, maximumBytes = 4_096) {
	return await new Promise((resolvePromise, rejectPromise) => {
		const chunks = [];
		let receivedBytes = 0;
		let settled = false;

		request.on('data', (chunk) => {
			if (settled) {
				return;
			}
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			receivedBytes += buffer.length;
			if (receivedBytes > maximumBytes) {
				settled = true;
				rejectPromise(Object.assign(new Error('Request body is too large'), { statusCode: 413 }));
				return;
			}
			chunks.push(buffer);
		});
		request.on('end', () => {
			if (settled) {
				return;
			}
			settled = true;
			try {
				resolvePromise(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
			} catch (error) {
				rejectPromise(error);
			}
		});
		request.on('error', (error) => {
			if (!settled) {
				settled = true;
				rejectPromise(error);
			}
		});
	});
}
