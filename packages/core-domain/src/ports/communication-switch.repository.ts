import type { CommunicationChannel, CommunicationSwitch } from '@saha-textile/contracts';

/**
 * Settings › Communications switches (`communicationSwitches`): one row per message × channel
 * that an operator has changed. A missing row means the recommended start state, so a fresh
 * database behaves exactly like the approved table without any seeding.
 */
export interface CommunicationSwitchRepository {
	list(): Promise<CommunicationSwitch[]>;
	find(use: string, channel: CommunicationChannel): Promise<CommunicationSwitch | null>;
	save(entry: CommunicationSwitch): Promise<CommunicationSwitch>;
}
