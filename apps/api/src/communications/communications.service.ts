import { randomUUID } from 'node:crypto';

import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	COMMUNICATION_CHANNELS,
	COMMUNICATION_GROUPS,
	COMMUNICATION_USES,
	type AuditLog,
	type CommunicationChannel,
	type CommunicationSettingsResponse,
	type CommunicationSwitch,
	type CommunicationSwitchWrite,
	type CommunicationUse,
} from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	type CommunicationChangeRefusal,
	type CommunicationSwitchRepository,
	communicationCellOn,
	decideCommunicationChange,
	isCommunicationCellLocked,
} from '@saha-textile/core-domain';

import { AdminSecurityService } from '../auth/admin-security.service';
import { domainRefusal } from '../auth/domain-refusal';
import { AUDIT_LOG_REPOSITORY, COMMUNICATION_SWITCH_REPOSITORY } from '../infra/tokens';

/** English fallbacks; the admin page shows its own translated sentence for each code. */
const REFUSALS: Readonly<Record<CommunicationChangeRefusal, string>> = {
	unknown_use: 'Unknown message',
	unavailable: 'This message cannot be sent on that channel',
	locked: 'This channel stays off: it is a security risk',
	email_required: 'Codes always go by email as well',
	phone_channel_required: 'SMS or WhatsApp must stay on for codes',
};

const cellKey = (use: string, channel: CommunicationChannel): string => `${use}.${channel}`;

/**
 * Settings › Communications (owner decision round 2026-11-13): which channels carry each message.
 *
 * The rules live in core (`decideCommunicationChange`); this service adds the password proof
 * and the audit row. A refused change answers 400 with the rule's code as a domain refusal, so
 * the page can name it; a wrong or missing password answers 403 'Invalid credentials', never 401, because the
 * session itself is fine and must not be signed out.
 */
@Injectable()
export class CommunicationsService {
	constructor(
		@Inject(COMMUNICATION_SWITCH_REPOSITORY) private readonly switches: CommunicationSwitchRepository,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		private readonly security: AdminSecurityService,
	) {}

	async view(): Promise<CommunicationSettingsResponse> {
		const stored = new Map((await this.switches.list()).map((row) => [cellKey(row.use, row.channel), row]));
		return {
			channels: [...COMMUNICATION_CHANNELS],
			groups: [...COMMUNICATION_GROUPS],
			items: COMMUNICATION_USES.map((use) => ({
				key: use.key,
				group: use.group,
				cells: {
					email: this.cell(use, 'email', stored.get(cellKey(use.key, 'email'))),
					sms: this.cell(use, 'sms', stored.get(cellKey(use.key, 'sms'))),
					whatsapp: this.cell(use, 'whatsapp', stored.get(cellKey(use.key, 'whatsapp'))),
				},
			})),
		};
	}

	async change(
		actorUserId: string,
		body: CommunicationSwitchWrite,
		requestId: string | null,
	): Promise<CommunicationSettingsResponse> {
		const use = COMMUNICATION_USES.find((row) => row.key === body.use);
		if (!use) throw new NotFoundException('Unknown message');
		const stored = new Map(
			(await Promise.all(COMMUNICATION_CHANNELS.map((channel) => this.switches.find(use.key, channel)))).flatMap(
				(row) => (row ? [[row.channel, row] as const] : []),
			),
		);
		const decision = decideCommunicationChange(COMMUNICATION_USES, body, (channel) =>
			communicationCellOn(use, channel, stored.get(channel)),
		);
		if (!decision.ok) throw domainRefusal(decision.reason, REFUSALS[decision.reason]);
		if (decision.needsPassword) {
			if (!body.currentPassword) throw new ForbiddenException('Invalid credentials');
			await this.security.confirmCurrentPassword(actorUserId, body.currentPassword);
		}
		// Saving the state a cell already has writes nothing and records nothing.
		if (decision.from !== body.on) {
			await this.switches.save({
				use: use.key,
				channel: body.channel,
				on: body.on,
				updatedBy: actorUserId,
				updatedAt: null,
			});
			await this.audit.append(this.entry(actorUserId, use.key, body.channel, decision, body, requestId));
		}
		return this.view();
	}

	private cell(use: CommunicationUse, channel: CommunicationChannel, stored: CommunicationSwitch | undefined) {
		const definition = use.cells[channel];
		return {
			available: definition.available,
			on: communicationCellOn(use, channel, stored),
			recommended: definition.on,
			risk: definition.risk,
			...(definition.reasonKey ? { reasonKey: definition.reasonKey } : {}),
			locked: isCommunicationCellLocked(use, channel),
			updatedAt: stored?.updatedAt ?? null,
		};
	}

	private entry(
		actorUserId: string,
		use: string,
		channel: CommunicationChannel,
		decision: { from: boolean; needsPassword: boolean },
		body: CommunicationSwitchWrite,
		requestId: string | null,
	): AuditLog {
		return {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action: 'communication.switch.change',
			entityType: 'communication_switch',
			entityId: cellKey(use, channel),
			severity: decision.needsPassword ? 'warn' : 'info',
			retentionTier: 'catalog_admin',
			diffs: [{ field: 'on', before: decision.from, after: body.on }],
			// Whether the password was asked and given, never the password itself.
			metadata: { use, channel, passwordConfirmed: decision.needsPassword },
			requestId,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
	}
}
