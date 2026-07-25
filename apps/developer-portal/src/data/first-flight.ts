/* ============================================================================
 * NEXT-GEN-UI · First Flight governed-data adapter
 * ----------------------------------------------------------------------------
 * WHAT: typed access to the compiled persona paths and route/anchor targets.
 * WHY: the route engine may own focus and current URL state, but it must not own
 * onboarding facts, page lifecycle claims, completion history, or selectors.
 * HOW: the portal-data compiler validates the authored dataset against current
 * documentation routes, headings, frontmatter, and the manifest before publish.
 * TUNING: author journey copy in docs/_data/instruments/first-flight.json;
 * never add fallback stops or status claims to React.
 * ========================================================================= */

import {
	usePortalData,
	type FirstFlightDebriefPolicy,
	type FirstFlightPersona,
	type FirstFlightPersonaId,
	type FirstFlightNavigationPolicy,
	type FirstFlightProgressPolicy,
	type FirstFlightStop,
	type FirstFlightTargetContract,
} from './portal-data';

export type {
	FirstFlightDebriefPolicy,
	FirstFlightPersona,
	FirstFlightPersonaId,
	FirstFlightNavigationPolicy,
	FirstFlightProgressPolicy,
	FirstFlightStop,
	FirstFlightTargetContract,
};

export function buildFirstFlightDestination(
	policy: FirstFlightNavigationPolicy,
	personaId: FirstFlightPersonaId,
	stepIndex: number,
	stop: FirstFlightStop,
): string {
	const query = [
		`${encodeURIComponent(policy.personaParam)}=${encodeURIComponent(personaId)}`,
		`${encodeURIComponent(policy.stepParam)}=${encodeURIComponent(String(stepIndex))}`,
	].join('&');
	return `${stop.route}?${query}#${stop.anchor}`;
}

export function useFirstFlightData() {
	return usePortalData().firstFlight;
}
