import type { Msg91HttpClient } from '../client.js';
import type { Msg91AdapterConfig, Msg91ToolDispatch, Msg91ToolResult } from '../types.js';

/** `POST https://control.msg91.com/api/v5/email/send` — template_id + variables. */
export async function sendEmailViaMsg91(
	client: Msg91HttpClient,
	config: Msg91AdapterConfig,
	dispatch: Msg91ToolDispatch,
): Promise<Msg91ToolResult> {
	const body: Record<string, unknown> = {
		recipients: [
			{
				to: [{ email: dispatch.destination }],
				variables: stringifyVariables(dispatch.variables),
			},
		],
		from: {
			email: config.emailFrom,
			...(config.emailFromName ? { name: config.emailFromName } : {}),
		},
		template_id: dispatch.providerTemplateId,
	};
	if (config.emailDomain) {
		body['domain'] = config.emailDomain;
	}
	return client.postJson('https://control.msg91.com/api/v5/email/send', body);
}

function stringifyVariables(variables: Record<string, string | number>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(variables)) {
		out[key] = String(value);
	}
	return out;
}
