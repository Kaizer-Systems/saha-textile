import { PaymentGatewayError } from '@saha-textile/core-domain';

import type { CcavenueCipher } from './ccavenue-cipher';
import { MerchantApiEnvelope, MerchantApiFailure } from './ccavenue-schemas';
import { parsePairs } from './ccavenue-wire';

/** 51419, 51313 and 51308 all mean CCAvenue found nothing for the search. */
const NO_RECORD_CODES: ReadonlySet<string> = new Set(['51419', '51313', '51308']);

export type MerchantApiCommand =
	'orderStatusTracker' | 'refundOrder' | 'getRefundDetails' | 'generateQuickInvoice' | 'invoiceList';

/** The guide prints 1.1 as the general value and asks for 1.2 on the Status call. */
const COMMAND_VERSIONS: Readonly<Record<MerchantApiCommand, string>> = {
	orderStatusTracker: '1.2',
	refundOrder: '1.1',
	getRefundDetails: '1.1',
	/** HDFC API document § 13: "The index says to pass version 1.2". */
	generateQuickInvoice: '1.2',
	invoiceList: '1.1',
};

const SERVLET_PATH = '/apis/servlet/DoWebTrans';

export type MerchantApiResult = { kind: 'found'; body: Record<string, unknown> } | { kind: 'no-record'; code: string };

interface MerchantApiOptions {
	apiUrl: string;
	accessCode: string;
	timeoutMs: number;
	fetch: typeof fetch;
}

const unreadable = (command: string): PaymentGatewayError =>
	new PaymentGatewayError('unreadable', `CCAvenue ${command} answer could not be read`);

/** Error codes arrive with stray spaces and full stops: `51304 `, `51407.`. */
const cleanCode = (code: string | null | undefined): string => (code ?? '').replace(/[^\d-]/g, '');

function failure(command: string, code: string): MerchantApiResult {
	if (NO_RECORD_CODES.has(code)) return { kind: 'no-record', code };
	throw new PaymentGatewayError('rejected', `CCAvenue refused ${command}`, code || null);
}

/**
 * The server-to-server `DoWebTrans` call. The working key stays inside the cipher, and nothing
 * here puts a request body, a reply or a credential into an error.
 */
export class CcavenueMerchantApi {
	readonly #cipher: CcavenueCipher;
	readonly #options: MerchantApiOptions;

	constructor(cipher: CcavenueCipher, options: MerchantApiOptions) {
		this.#cipher = cipher;
		this.#options = options;
	}

	async call(command: MerchantApiCommand, request: Readonly<Record<string, string>>): Promise<MerchantApiResult> {
		const envelope = MerchantApiEnvelope.safeParse(parsePairs(await this.#post(command, request)));
		if (!envelope.success) throw unreadable(command);
		if (envelope.data.status === '1') return failure(command, cleanCode(envelope.data.enc_error_code));

		const body = this.#decryptBody(command, envelope.data.enc_response);
		const inner = MerchantApiFailure.safeParse(body);
		if (!inner.success) throw unreadable(command);
		// A refund refusal is an answer, not a failed call: `refund_status` carries it.
		if (command === 'refundOrder') return { kind: 'found', body: inner.data };
		const code = cleanCode(inner.data.error_code);
		if (code || inner.data.status === '1') return failure(command, code);
		return { kind: 'found', body: inner.data };
	}

	async #post(command: MerchantApiCommand, request: Readonly<Record<string, string>>): Promise<string> {
		const form = new URLSearchParams({
			enc_request: this.#cipher.encrypt(JSON.stringify(request)),
			access_code: this.#options.accessCode,
			command,
			request_type: 'JSON',
			response_type: 'JSON',
			version: COMMAND_VERSIONS[command],
		});
		let response: Response;
		let text: string;
		try {
			response = await this.#options.fetch(`${this.#options.apiUrl}${SERVLET_PATH}`, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: form.toString(),
				redirect: 'error',
				signal: AbortSignal.timeout(this.#options.timeoutMs),
			});
			text = await response.text();
		} catch {
			throw new PaymentGatewayError('unavailable', `CCAvenue ${command} request failed`);
		}
		if (!response.ok) {
			throw new PaymentGatewayError('unavailable', `CCAvenue ${command} answered HTTP ${response.status}`);
		}
		return text.trim();
	}

	#decryptBody(command: string, cipherHex: string | undefined): unknown {
		try {
			return JSON.parse(this.#cipher.decrypt((cipherHex ?? '').trim()));
		} catch {
			throw unreadable(command);
		}
	}
}
