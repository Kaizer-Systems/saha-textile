import type { Msg91HttpClient } from '../client.js';
import type { Msg91AdapterConfig, Msg91ToolDispatch, Msg91ToolResult } from '../types.js';

/**
 * `POST https://control.msg91.com/api/v5/flow` — MSG91 Flow API.
 *
 * `providerTemplateId` is the Flow id. TRAI DLT header/template live inside the
 * Flow in MSG91; we optionally pass `sender` from env (`MSG91_SENDER_ID` / SAHATX).
 */
export async function sendSmsFlowViaMsg91(
	client: Msg91HttpClient,
	config: Msg91AdapterConfig,
	dispatch: Msg91ToolDispatch,
): Promise<Msg91ToolResult> {
	const mobiles = normalizeE164Digits(dispatch.destination);
	const recipient: Record<string, string> = { mobiles };
	for (const [key, value] of Object.entries(dispatch.variables)) {
		recipient[key] = String(value);
	}
	const body: Record<string, unknown> = {
		flow_id: dispatch.providerTemplateId,
		recipients: [recipient],
	};
	if (config.senderId) {
		body['sender'] = config.senderId;
	}
	return client.postJson('https://control.msg91.com/api/v5/flow', body);
}

/** Strip non-digits so Flow gets `91…` style mobiles. */
export function normalizeE164Digits(destination: string): string {
	return destination.replace(/\D/g, '');
}
