/**
 * PayPal settings (orders brief, owner 2026-11-20: "PAYPAL_ENV set in dev staging and prod in
 * infisical as sandbox for dev and staging and live for production").
 *
 * PayPal is on only when the client id, the secret and `PAYPAL_ENV` are all set and `PAYPAL_ENV`
 * fits where the server runs: `live` only in production, `sandbox` everywhere else. A mismatch
 * fails closed: PayPal is off, a startup line says why, and nothing is sent to PayPal. Key values
 * are never printed.
 */

export type PayPalEnvironment = 'sandbox' | 'live';

export interface PayPalConfigInput {
	clientId?: string | null;
	clientSecret?: string | null;
	env?: string | null;
	webhookId?: string | null;
	/** `local`, `staging` or `production` (`DEPLOY_ENV`); unset counts as not production. */
	deployEnv?: string | null;
}

export type PayPalOffReason =
	'keysMissing' | 'envMissing' | 'envUnknown' | 'liveOutsideProduction' | 'sandboxInProduction';

export type PayPalConfig =
	| {
			configured: true;
			clientId: string;
			clientSecret: string;
			environment: PayPalEnvironment;
			webhookId: string | null;
			apiBase: string;
	  }
	| { configured: false; reason: PayPalOffReason };

export const PAYPAL_API_BASE: Readonly<Record<PayPalEnvironment, string>> = {
	sandbox: 'https://api-m.sandbox.paypal.com',
	live: 'https://api-m.paypal.com',
};

/** The startup line for each reason PayPal stays off (names only, never values). */
export const PAYPAL_OFF_MESSAGES: Readonly<Record<PayPalOffReason, string>> = {
	keysMissing: 'PayPal is off: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not both set.',
	envMissing: 'PayPal is off: PAYPAL_ENV is not set (sandbox or live).',
	envUnknown: 'PayPal is off: PAYPAL_ENV must be sandbox or live.',
	liveOutsideProduction: 'PayPal is off: PAYPAL_ENV is live but this server is not production (DEPLOY_ENV).',
	sandboxInProduction: 'PayPal is off: PAYPAL_ENV is sandbox on a production server (DEPLOY_ENV=production).',
};

export function parsePayPalConfig(input: PayPalConfigInput): PayPalConfig {
	const clientId = input.clientId?.trim() || null;
	const clientSecret = input.clientSecret?.trim() || null;
	if (!clientId || !clientSecret) return { configured: false, reason: 'keysMissing' };
	const env = input.env?.trim().toLowerCase() || null;
	if (!env) return { configured: false, reason: 'envMissing' };
	if (env !== 'sandbox' && env !== 'live') return { configured: false, reason: 'envUnknown' };
	const production = input.deployEnv?.trim().toLowerCase() === 'production';
	if (env === 'live' && !production) return { configured: false, reason: 'liveOutsideProduction' };
	if (env === 'sandbox' && production) return { configured: false, reason: 'sandboxInProduction' };
	return {
		configured: true,
		clientId,
		clientSecret,
		environment: env,
		webhookId: input.webhookId?.trim() || null,
		apiBase: PAYPAL_API_BASE[env],
	};
}
