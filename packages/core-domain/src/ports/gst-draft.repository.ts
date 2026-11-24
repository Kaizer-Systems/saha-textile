import type { GstDraftType, GstReturnDraft } from '@saha-textile/contracts';

/** GST return drafts (accounts brief G4, G6): one per registration, return and month. */
export interface GstReturnDraftRepository {
	get(id: string): Promise<GstReturnDraft | null>;
	find(gstRegistrationId: string, returnType: GstDraftType, month: string): Promise<GstReturnDraft | null>;
	listForRegistration(gstRegistrationId: string): Promise<GstReturnDraft[]>;
	/**
	 * A new draft (`expectedVersion` null; refused with `gst_draft_exists`), or a change over the version read (stored
	 * one higher; refused with `gst_draft_changed` when someone saved first).
	 */
	save(draft: GstReturnDraft, expectedVersion: number | null): Promise<GstReturnDraft>;
}
