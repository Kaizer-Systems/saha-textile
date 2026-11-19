import type {
	ShippingException,
	ShippingRuleSet,
	ShippingRuleSetVersion,
	ShippingSettings,
} from '@saha-textile/contracts';

/**
 * Shipping rule sets, their versions, where they apply, and the zone settings
 * (`shippingRuleSets`, `shippingRuleSetVersions`, `shippingExceptions`, `shippingProviderConfigs`).
 *
 * Saves name the revision they started from; a save made against an older revision is refused
 * (two admins editing one rule set: the second save is refused, nothing is overwritten).
 */
export interface ShippingRuleRepository {
	listRuleSets(): Promise<ShippingRuleSet[]>;
	findRuleSet(id: string): Promise<ShippingRuleSet | null>;
	/** Writes a new rule set; false when the id is taken. */
	createRuleSet(ruleSet: ShippingRuleSet): Promise<boolean>;
	/** Writes the rule set when its stored revision is `expectedRevision`; false otherwise. */
	saveRuleSet(ruleSet: ShippingRuleSet, expectedRevision: number): Promise<boolean>;
	/** Deletes a rule set with no active version history in use; false when the revision moved. */
	deleteRuleSet(id: string, expectedRevision: number): Promise<boolean>;
	/** Stores a new version and the rule set pointing at it, in one transaction; false on a revision clash. */
	activate(ruleSet: ShippingRuleSet, version: ShippingRuleSetVersion, expectedRevision: number): Promise<boolean>;
	findVersion(ruleSetId: string, version: number): Promise<ShippingRuleSetVersion | null>;
	/** Newest first. */
	listVersions(ruleSetId: string): Promise<ShippingRuleSetVersion[]>;
	/** The active version of each rule set asked for that has one. */
	activeVersions(ruleSetIds: readonly string[]): Promise<ShippingRuleSetVersion[]>;
	/** The one-time release step for a pre-made rule set: writes it and its version 1 only where missing. */
	createPremadeIfMissing(ruleSet: ShippingRuleSet, version: ShippingRuleSetVersion): Promise<boolean>;

	getSettings(): Promise<ShippingSettings | null>;
	/** Writes the settings when the stored revision is `expectedRevision` (0 for none yet); false otherwise. */
	saveSettings(settings: ShippingSettings, expectedRevision: number): Promise<boolean>;

	listExceptions(): Promise<ShippingException[]>;
	saveException(exception: ShippingException): Promise<void>;
	deleteException(id: string): Promise<boolean>;

	/**
	 * Live products with no weight and no full box of their own whose main category is not one of
	 * `categoryIdsWithBox` (categories that give a weight or box themselves or through a parent).
	 * Variants that set their own are not looked at; the overview check says "no weight or box size".
	 */
	countProductsWithoutBox(categoryIdsWithBox: readonly string[]): Promise<number>;
	/** Products (any status but discontinued) whose main category is one of these, and how many set a charge. */
	chargeUsage(mainCategoryIds: readonly string[]): Promise<{ products: number; ownCharges: number }>;
}
