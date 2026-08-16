import type { Msg91HttpClient } from '../client.js';
import type { Msg91AdapterConfig, Msg91ToolDispatch, Msg91ToolResult } from '../types.js';

/**
 * `POST https://control.msg91.com/api/v5/flow` — MSG91 Flow API.
 *
 * `providerTemplateId` is the Flow/Template id. TRAI DLT header/template live inside the
 * Flow in MSG91; we optionally pass `sender` from env (`MSG91_SENDER_ID` / SAHATX).
 *
 * ## ⚠ PENDING LIVE VERIFICATION — the id field name
 *
 * MSG91 renamed this concept from "Flow" to "Template" across v5, and both `flow_id` and
 * `template_id` have been accepted by that endpoint at different times. MSG91's own API
 * reference is behind a login, so the field name below is taken from their current public
 * documentation and third-party integration guides, which say `template_id`.
 *
 * Both keys are sent deliberately. They carry the SAME value, so whichever name the account's
 * API version honours receives the correct id and the other is surplus — a one-field
 * redundancy that turns a coin-flip into a certainty until the first real send confirms which
 * is live. Drop the loser then; do not guess now.
 *
 * Tracked in `project-progress.mdx` as owed verification against a real MSG91 account.
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
		// Same value under both names — see the PENDING LIVE VERIFICATION note above.
		template_id: dispatch.providerTemplateId,
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
