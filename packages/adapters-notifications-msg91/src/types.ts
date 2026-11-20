/**
 * Shared MSG91 HTTP / tool shapes.
 *
 * Authkey stays in API env only (`MSG91_AUTH_KEY`) — never passed through admin UI
 * (owner lock: option A). Template / flow / WhatsApp ids live in DB as non-secrets.
 */

export interface Msg91AdapterConfig {
	authKey: string;
	senderId?: string;
	/**
	 * The From address for one of our templates. The API picks it by the template's group on
	 * Settings › Communications (`MSG91_EMAIL_FROM_ACCOUNT`, `_ORDERS`, `_SHOP`, `_MARKETING`).
	 */
	emailFromFor: (templateKey: string) => string;
	emailFromName?: string;
	emailDomain?: string;
	whatsappNumber?: string;
}

export type Msg91ToolName = 'email.send' | 'sms.flow' | 'whatsapp.outbound';

export interface Msg91ToolDispatch {
	tool: Msg91ToolName;
	/** Our own template key; the email tool picks the From address by it. */
	templateKey: string;
	/** Provider template / flow / WhatsApp template id already resolved from DB. */
	providerTemplateId: string;
	destination: string;
	variables: Record<string, string | number>;
}

export interface Msg91ToolResult {
	ok: boolean;
	providerMessageId: string | null;
	errorMessage: string | null;
	/** Raw HTTP status for diagnostics (never logged with destination). */
	httpStatus: number;
}

export type Msg91Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
