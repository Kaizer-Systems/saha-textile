import type { CommunicationSettingsResponse, CommunicationSwitchWrite } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export type { CommunicationSettingsResponse, CommunicationSwitchWrite };

/** Settings › Communications: the message × channel table, read and changed one cell at a time. */
export abstract class AdminCommunicationsGateway {
	abstract settings(): Observable<CommunicationSettingsResponse>;
	/** Answers the whole table as stored after the change. */
	abstract change(input: CommunicationSwitchWrite): Observable<CommunicationSettingsResponse>;
}
