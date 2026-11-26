import { describe, expect, it, vi } from 'vitest';

import type { Msg91HttpClient } from '../src/client.js';
import { sendEmailViaMsg91 } from '../src/tools/email.tool.js';
import { dispatchMsg91Tool } from '../src/tools/registry.js';
import { normalizeE164Digits, sendSmsFlowViaMsg91 } from '../src/tools/sms-flow.tool.js';
import { sendWhatsappViaMsg91 } from '../src/tools/whatsapp.tool.js';
import type { Msg91AdapterConfig, Msg91ToolDispatch } from '../src/types.js';

const sent = { ok: true, providerMessageId: 'p1', errorMessage: null, httpStatus: 200 };

const recorder = () => {
	const postJson = vi.fn(async (_url: string, _body: unknown) => sent);
	return { postJson, client: { postJson } as unknown as Msg91HttpClient };
};

const config: Msg91AdapterConfig = {
	authKey: 'test-key',
	emailFromFor: (templateKey) =>
		templateKey === 'back_in_stock' ? 'notifications@sahatextile.com' : 'no-reply@sahatextile.com',
};

const dispatch = (overrides: Partial<Msg91ToolDispatch>): Msg91ToolDispatch => ({
	tool: 'email.send',
	templateKey: 'otp_login',
	providerTemplateId: 'tpl_1',
	destination: 'buyer@example.test',
	variables: { code: 123456, name: 'Asha' },
	...overrides,
});

const bodyOf = (postJson: ReturnType<typeof recorder>['postJson']) =>
	postJson.mock.calls[0]?.[1] as Record<string, unknown>;

describe('email tool', () => {
	it('sends text variables and leaves optional settings out', async () => {
		const { client, postJson } = recorder();
		await sendEmailViaMsg91(client, config, dispatch({}));
		expect(bodyOf(postJson)).toEqual({
			recipients: [{ to: [{ email: 'buyer@example.test' }], variables: { code: '123456', name: 'Asha' } }],
			from: { email: 'no-reply@sahatextile.com' },
			template_id: 'tpl_1',
		});
	});

	it('keeps an order email’s item list and yes/no flags as JSON (Handlebars #each and #if)', async () => {
		const { client, postJson } = recorder();
		await sendEmailViaMsg91(
			client,
			config,
			dispatch({
				templateKey: 'order_confirmed',
				variables: {
					order_number: 'ST-2611-482190',
					items: [{ name: 'Red Banarasi', quantity: 2, total: '₹20,400' }],
					has_cancel_note: false,
				},
			}),
		);
		expect(bodyOf(postJson)).toMatchObject({
			recipients: [
				{
					variables: {
						order_number: 'ST-2611-482190',
						items: [{ name: 'Red Banarasi', quantity: '2', total: '₹20,400' }],
						has_cancel_note: false,
					},
				},
			],
		});
	});

	it("sends from the address of the template's group", async () => {
		const { client, postJson } = recorder();
		await sendEmailViaMsg91(client, config, dispatch({ templateKey: 'back_in_stock' }));
		expect(bodyOf(postJson)).toMatchObject({ from: { email: 'notifications@sahatextile.com' } });
	});

	it('adds the sender name and domain when configured', async () => {
		const { client, postJson } = recorder();
		await sendEmailViaMsg91(
			client,
			{ ...config, emailFromName: 'Saha Textile', emailDomain: 'mail.sahatextile.com' },
			dispatch({}),
		);
		expect(bodyOf(postJson)).toMatchObject({
			from: { name: 'Saha Textile' },
			domain: 'mail.sahatextile.com',
		});
	});
});

describe('SMS flow tool', () => {
	it('strips a mobile to digits', () => {
		expect(normalizeE164Digits('+91 98300-12345')).toBe('919830012345');
	});

	it('sends the id under both names, and no sender unless configured', async () => {
		const { client, postJson } = recorder();
		await sendSmsFlowViaMsg91(client, config, dispatch({ tool: 'sms.flow', destination: '+919830012345' }));
		expect(postJson.mock.calls[0]?.[0]).toBe('https://control.msg91.com/api/v5/flow');
		expect(bodyOf(postJson)).toEqual({
			template_id: 'tpl_1',
			flow_id: 'tpl_1',
			recipients: [{ mobiles: '919830012345', code: '123456', name: 'Asha' }],
		});
	});

	it('sends text only: an email-only list or flag never reaches a DLT template', async () => {
		const { client, postJson } = recorder();
		await sendSmsFlowViaMsg91(
			client,
			config,
			dispatch({
				tool: 'sms.flow',
				destination: '+919830012345',
				variables: { order_number: 'ST2611482190', amount: 23_050, items: [{ name: 'x' }], has_refund: true },
			}),
		);
		expect(bodyOf(postJson)['recipients']).toEqual([
			{ mobiles: '919830012345', order_number: 'ST2611482190', amount: '23050' },
		]);
	});

	it('passes the DLT sender when configured', async () => {
		const { client, postJson } = recorder();
		await sendSmsFlowViaMsg91(client, { ...config, senderId: 'SAHATX' }, dispatch({ tool: 'sms.flow' }));
		expect(bodyOf(postJson)['sender']).toBe('SAHATX');
	});
});

describe('WhatsApp tool', () => {
	const whatsapp = { ...config, whatsappNumber: '+91 98300 00000' };

	it('fails without a configured number and without calling MSG91', async () => {
		const { client, postJson } = recorder();
		const result = await sendWhatsappViaMsg91(client, config, dispatch({ tool: 'whatsapp.outbound' }));
		expect(result).toMatchObject({ ok: false, errorMessage: 'MSG91_WHATSAPP_NUMBER is not configured' });
		expect(postJson).not.toHaveBeenCalled();
	});

	it('sends the variables as body parameters', async () => {
		const { client, postJson } = recorder();
		await sendWhatsappViaMsg91(
			client,
			whatsapp,
			dispatch({ tool: 'whatsapp.outbound', destination: '+919830012345' }),
		);
		expect(bodyOf(postJson)).toMatchObject({
			integrated_number: '919830000000',
			payload: {
				to: '919830012345',
				template: {
					name: 'tpl_1',
					components: [
						{
							type: 'body',
							parameters: [
								{ type: 'text', text: '123456' },
								{ type: 'text', text: 'Asha' },
							],
						},
					],
				},
			},
		});
	});

	it('leaves components out when there are no variables', async () => {
		const { client, postJson } = recorder();
		await sendWhatsappViaMsg91(client, whatsapp, dispatch({ tool: 'whatsapp.outbound', variables: {} }));
		const payload = bodyOf(postJson)['payload'] as { template: object };
		expect(payload.template).not.toHaveProperty('components');
	});
});

describe('tool registry', () => {
	it.each([
		['email.send', 'https://control.msg91.com/api/v5/email/send'],
		['sms.flow', 'https://control.msg91.com/api/v5/flow'],
		['whatsapp.outbound', 'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/'],
	] as const)('routes %s', async (tool, url) => {
		const { client, postJson } = recorder();
		await dispatchMsg91Tool(client, { ...config, whatsappNumber: '919830000000' }, dispatch({ tool }));
		expect(postJson.mock.calls[0]?.[0]).toBe(url);
	});

	it('refuses a tool it does not know', async () => {
		const { client, postJson } = recorder();
		const result = await dispatchMsg91Tool(client, config, dispatch({ tool: 'fax.send' as never }));
		expect(result).toEqual({
			ok: false,
			providerMessageId: null,
			errorMessage: 'Unknown MSG91 tool: fax.send',
			httpStatus: 0,
		});
		expect(postJson).not.toHaveBeenCalled();
	});
});
