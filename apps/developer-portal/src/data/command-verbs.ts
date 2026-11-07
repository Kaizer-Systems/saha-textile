/* ============================================================================
 * NEXT-GEN-UI · ⌘K Verbs governed-data adapter
 * ----------------------------------------------------------------------------
 * WHAT: typed access to the compiled trace/gate/status action grammar.
 * WHY: the palette may own query and focus state, but it must not own page,
 * gate, lifecycle or routing facts.
 * HOW: the portal-data compiler derives targets from documentation frontmatter
 * and governed gate data, validates every route, then publishes this payload.
 * TUNING: author grammar copy in docs/_data/instruments/command-verbs.json;
 * never add a static target list to React.
 * ========================================================================= */

import {
	usePortalData,
	type CommandTargetKind,
	type CommandTargetSource,
	type CommandVerb,
	type CommandVerbTarget,
} from './portal-data';

export type { CommandTargetKind, CommandTargetSource, CommandVerb, CommandVerbTarget };

export function useCommandVerbData() {
	return usePortalData().commandVerbs;
}
