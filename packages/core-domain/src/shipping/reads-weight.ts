import type { ShippingConditionGroup, ShippingNode, ShippingRuleSetBody } from '@saha-textile/contracts';

/**
 * Whether a rule set needs products' weight or box: a weight condition, a weight band, or a charge per
 * kg. The overview's "N products have no weight or box size" check is only a problem when one does.
 */
export function ruleSetReadsWeight(body: ShippingRuleSetBody): boolean {
	return body.steps.some((step) => nodeReadsWeight(step.node));
}

const isWeight = (field: string | null | undefined): boolean => Boolean(field?.endsWith('chargeableWeight'));

function groupReadsWeight(group: ShippingConditionGroup): boolean {
	return group.items.some((item) => (item.kind === 'group' ? groupReadsWeight(item) : isWeight(item.field)));
}

function nodeReadsWeight(node: ShippingNode | null): boolean {
	if (!node) return false;
	switch (node.kind) {
		case 'result':
			return node.result.kind === 'amount' && node.result.per === 'kg';
		case 'if':
			return groupReadsWeight(node.when) || nodeReadsWeight(node.then) || nodeReadsWeight(node.otherwise);
		case 'bands':
			return (
				isWeight(node.field) ||
				node.bands.some((band) => nodeReadsWeight(band.then)) ||
				nodeReadsWeight(node.otherwise)
			);
	}
}
