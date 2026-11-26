import { z } from 'zod';

/**
 * The worklist (brief 26 WL1, WL2; approved 2026-11-26): every item waiting on a person, from anywhere in the admin.
 * Each row comes from its own place: what it needs (approve, fix, check), the area, what it says (a word and its
 * figures), who asked and since when, where it opens (the page and what to open there), and whether a tick or a
 * cross answers it in the row. Any later feature adds its own kind in the same shape.
 */
export const WorklistKind = z.enum([
	'attendance_change',
	'leave_asked',
	'payslip_blocking',
	'salary_below_minimum',
	'opening_leave_over_cap',
	'stock_approval',
]);
export type WorklistKind = z.infer<typeof WorklistKind>;

export const WorklistRow = z.object({
	/** `<kind>:<the item's own id>`. */
	id: z.string(),
	kind: WorklistKind,
	needs: z.enum(['approve', 'fix', 'check']),
	area: z.enum(['payroll', 'stock', 'accounts']),
	params: z.record(z.string(), z.union([z.string(), z.number()])),
	askedBy: z.string().nullable(),
	since: z.string(),
	open: z.object({ path: z.array(z.string()), query: z.record(z.string(), z.string()).default({}) }),
	/** ✓ ✕ in the row: a yes-or-no item. */
	answerable: z.boolean(),
});
export type WorklistRow = z.infer<typeof WorklistRow>;

/** ✕ asks for a reason, which reaches the asker. */
export const WorklistAnswer = z.object({ reason: z.string().trim().max(300).default('') });
export type WorklistAnswer = z.infer<typeof WorklistAnswer>;
