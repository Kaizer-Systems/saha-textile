import type { Msg91HttpClient } from '../client.js';
import type { Msg91AdapterConfig, Msg91ToolDispatch, Msg91ToolResult } from '../types.js';
import { normalizeE164Digits } from './sms-flow.tool.js';

/**
 * `POST …/whatsapp/whatsapp-outbound-message/` — template outbound.
 *
 * `providerTemplateId` is the approved WhatsApp template name/id from DB.
 * Integrated number comes from env (`MSG91_WHATSAPP_NUMBER`), never admin Authkey UI.
 */
export async function sendWhatsappViaMsg91(
	client: Msg91HttpClient,
	config: Msg91AdapterConfig,
	dispatch: Msg91ToolDispatch,
): Promise<Msg91ToolResult> {
	if (!config.whatsappNumber) {
		return {
			ok: false,
			providerMessageId: null,
			errorMessage: 'MSG91_WHATSAPP_NUMBER is not configured',
			httpStatus: 0,
		};
	}

	const to = normalizeE164Digits(dispatch.destination);
	const from = normalizeE164Digits(config.whatsappNumber);
	const bodyParameters = Object.values(dispatch.variables).map((value) => ({
		type: 'text',
		text: String(value),
	}));

	const body = {
		integrated_number: from,
		content_type: 'template',
		payload: {
			to,
			type: 'template',
			template: {
				name: dispatch.providerTemplateId,
				language: {
					code: 'en',
					policy: 'deterministic',
				},
				...(bodyParameters.length > 0
					? {
							components: [
								{
									type: 'body',
									parameters: bodyParameters,
								},
							],
						}
					: {}),
			},
		},
	};

	return client.postJson('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/', body);
}
