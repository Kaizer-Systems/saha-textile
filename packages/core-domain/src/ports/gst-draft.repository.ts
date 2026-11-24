import type { GstDraftType, GstReturnDraft, Gstr2bImport } from '@saha-textile/contracts';

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

/** Imported GSTR-2B files (accounts brief G5): one per registration and month, with what was done on the portal (IMS). */
export interface Gstr2bRepository {
	find(gstRegistrationId: string, month: string): Promise<Gstr2bImport | null>;
	listForRegistration(gstRegistrationId: string): Promise<Gstr2bImport[]>;
	/**
	 * A new import (`expectedVersion` null; refused with `gstr2b_exists`), or a change over the version read (stored one
	 * higher; refused with `gstr2b_changed` when someone saved first).
	 */
	save(doc: Gstr2bImport, expectedVersion: number | null): Promise<Gstr2bImport>;
}
