import type { NotificationChannel } from '@saha-textile/contracts';

import type { Msg91HttpClient } from '../client.js';
import type { Msg91AdapterConfig, Msg91ToolDispatch, Msg91ToolName, Msg91ToolResult } from '../types.js';
import { sendEmailViaMsg91 } from './email.tool.js';
import { sendSmsFlowViaMsg91 } from './sms-flow.tool.js';
import { sendWhatsappViaMsg91 } from './whatsapp.tool.js';

/**
 * Channel → MSG91 tool registry. New channels add a tool here; the adapter stays stable.
 */
export const CHANNEL_TOOL: Record<NotificationChannel, Msg91ToolName> = {
	email: 'email.send',
	sms: 'sms.flow',
	whatsapp: 'whatsapp.outbound',
};

export async function dispatchMsg91Tool(
	client: Msg91HttpClient,
	config: Msg91AdapterConfig,
	dispatch: Msg91ToolDispatch,
): Promise<Msg91ToolResult> {
	switch (dispatch.tool) {
		case 'email.send':
			return sendEmailViaMsg91(client, config, dispatch);
		case 'sms.flow':
			return sendSmsFlowViaMsg91(client, config, dispatch);
		case 'whatsapp.outbound':
			return sendWhatsappViaMsg91(client, config, dispatch);
		default: {
			const _exhaustive: never = dispatch.tool;
			return {
				ok: false,
				providerMessageId: null,
				errorMessage: `Unknown MSG91 tool: ${String(_exhaustive)}`,
				httpStatus: 0,
			};
		}
	}
}
