import { PREMADE_RULE_SETS, premadeRuleSetId } from '@saha-textile/core-domain';

import { MongoShippingRuleRepository } from '../repositories/shipping.repository';

/**
 * Migration 0008 (shipping rules brief, approved 2026-11-19): the seven pre-made rule sets, each with
 * an active version 1, written once. They are locked; a business copies one to change it. A pre-made
 * rule set already stored is never overwritten. Zone settings are not seeded: a shop sets them in
 * Shipping › Overview, and until then checkout reports that shipping isn't set up.
 */
export async function seedPremadeShippingRuleSets(now = new Date()): Promise<string> {
	const repository = new MongoShippingRuleRepository();
	const at = now.toISOString();
	let written = 0;
	for (const premade of PREMADE_RULE_SETS) {
		const id = premadeRuleSetId(premade.key);
		const created = await repository.createPremadeIfMissing(
			{
				id,
				name: premade.name,
				description: premade.description,
				use: premade.use,
				kind: 'premade',
				premadeKey: premade.key,
				copiedFromId: null,
				activeVersion: 1,
				draft: premade.body,
				hasDraftChanges: false,
				testCarts: [],
				revision: 1,
				createdAt: at,
				updatedAt: at,
				updatedBy: null,
			},
			{ ruleSetId: id, version: 1, body: premade.body, activatedAt: at, activatedBy: null, acceptedChanges: [] },
		);
		if (created) written += 1;
	}
	return `wrote ${written} pre-made shipping rule set${written === 1 ? '' : 's'}`;
}
