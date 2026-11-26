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

/** GSTR-9's notes (accounts brief G9): why each table differs from the books, one record per registration and year. */
export interface GstAnnualNoteRepository {
	get(gstRegistrationId: string, year: string): Promise<{ notes: Record<string, string>; version: number } | null>;
	/** Refused with `gst_annual_changed` when someone saved since `expectedVersion` (null = the first save). */
	save(
		gstRegistrationId: string,
		year: string,
		notes: Record<string, string>,
		expectedVersion: number | null,
	): Promise<number>;
}
