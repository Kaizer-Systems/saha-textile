import type { PageSection, SavedBlock } from '@saha-textile/contracts';

/**
 * Saved blocks (Page Builder SG-5, P7, Q18 A). A copy is an ordinary section that remembers where it came from; a
 * linked section draws its block's current content, so one change to the block reaches every layout using it, at
 * that layout's next Go Live (the revision that goes live holds the block's content as it is then).
 */

/** A deep copy of plain stored data (core runs without the browser's `structuredClone`). */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The block ids a layout's sections are linked to, once each. */
export function linkedBlockIds(sections: readonly PageSection[]): string[] {
	return [...new Set(sections.flatMap((section) => (section.block?.linked ? [section.block.id] : [])))];
}

/**
 * The sections with every linked one drawn from its block: the block's content, under the layout's own section id,
 * hiding and link. A block that is gone leaves the section as it was last drawn.
 */
export function withLinkedBlocks(
	sections: readonly PageSection[],
	blocks: ReadonlyMap<string, Pick<SavedBlock, 'section'>>,
): PageSection[] {
	return sections.map((section) => {
		const block = section.block?.linked ? blocks.get(section.block.id) : undefined;
		if (!block) return section;
		return {
			...copy(block.section),
			id: section.id,
			hidden: section.hidden,
			block: section.block,
		} as PageSection;
	});
}

/** A block's section as stored: its own content, with no id ties to a layout. */
export function blockSection(section: PageSection, blockId: string): PageSection {
	return { ...copy(section), id: blockId, block: null, hidden: false } as PageSection;
}
