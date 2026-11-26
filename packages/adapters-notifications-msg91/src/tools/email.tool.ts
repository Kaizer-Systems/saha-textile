import type { Msg91HttpClient } from '../client.js';
import type { Msg91AdapterConfig, Msg91ToolDispatch, Msg91ToolResult, Msg91Variable } from '../types.js';

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
			email: config.emailFromFor(dispatch.templateKey),
			...(config.emailFromName ? { name: config.emailFromName } : {}),
		},
		template_id: dispatch.providerTemplateId,
	};
	if (config.emailDomain) {
		body['domain'] = config.emailDomain;
	}
	return client.postJson('https://control.msg91.com/api/v5/email/send', body);
}

/**
 * Text and numbers go as text. Lists (an order's items, for `{{#each}}`) and yes/no flags (for
 * `{{#if}}`) go as JSON values: the string "false" would read as true in a Handlebars `#if`.
 */
function stringifyVariables(
	variables: Record<string, Msg91Variable>,
): Record<string, string | boolean | ReadonlyArray<Readonly<Record<string, string>>>> {
	const out: Record<string, string | boolean | ReadonlyArray<Readonly<Record<string, string>>>> = {};
	for (const [key, value] of Object.entries(variables)) {
		if (typeof value === 'boolean') out[key] = value;
		else if (Array.isArray(value)) {
			out[key] = value.map((row: Readonly<Record<string, string | number>>) =>
				Object.fromEntries(Object.entries(row).map(([name, cell]) => [name, String(cell)])),
			);
		} else out[key] = String(value);
	}
	return out;
}
