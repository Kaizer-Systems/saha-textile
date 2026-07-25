/**
 * The base document-content structure follows Docusaurus theme-classic 3.10.2,
 * licensed under MIT. Portal-specific toolbar and provenance surfaces are added
 * without changing the Markdown rendering contract.
 */

import React, { type ReactNode, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useDoc } from '@docusaurus/plugin-content-docs/client';
import { ThemeClassNames } from '@docusaurus/theme-common';
import Heading from '@theme/Heading';
import MDXContent from '@theme/MDXContent';
import type { Props } from '@theme/DocItem/Content';

const supportedStatuses = ['implemented', 'scaffolded', 'planned', 'deferred', 'deprecated'] as const;

type DocumentationStatus = (typeof supportedStatuses)[number];
type CopyState = 'idle' | 'copied' | 'failed';

function isDocumentationStatus(value: unknown): value is DocumentationStatus {
	return typeof value === 'string' && supportedStatuses.some((status) => status === value);
}

function normalizeList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string');
	}

	return typeof value === 'string' ? [value] : [];
}

function humanize(value: string): string {
	return value
		.split('-')
		.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
		.join(' ');
}

function useSyntheticTitle(): string | null {
	const { metadata, frontMatter, contentTitle } = useDoc();
	const shouldRender = !frontMatter.hide_title && typeof contentTitle === 'undefined';
	return shouldRender ? metadata.title : null;
}

export default function DocItemContent({ children }: Props): ReactNode {
	const { frontMatter } = useDoc();
	const syntheticTitle = useSyntheticTitle();
	const [copyState, setCopyState] = useState<CopyState>('idle');
	const portalFrontMatter = frontMatter as Record<string, unknown>;
	const status = isDocumentationStatus(portalFrontMatter.status) ? portalFrontMatter.status : 'scaffolded';
	const audiences = normalizeList(portalFrontMatter.audience);
	const sources = normalizeList(portalFrontMatter.source_of_truth);
	const lastVerified =
		typeof portalFrontMatter.last_verified === 'string' ? portalFrontMatter.last_verified : 'Not recorded';

	const copyPage = useCallback(async () => {
		const content = document.querySelector<HTMLElement>('.theme-doc-markdown');
		const pageText = content?.innerText.trim();

		if (!pageText) {
			setCopyState('failed');
			return;
		}

		try {
			await navigator.clipboard.writeText(pageText);
			setCopyState('copied');
			window.setTimeout(() => setCopyState('idle'), 1800);
		} catch {
			setCopyState('failed');
		}
	}, []);

	const copyLabel = copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy page';

	// NEXT-GEN-UI: `wide: true` frontmatter widens the whole content column (the
	// width rules read --portal-content-max-width, which cascades to the toolbar,
	// provenance and markdown together). Instrument pages opt in so their wide
	// visuals use the horizontal space instead of being boxed at the prose width.
	const isWide = portalFrontMatter.wide === true;
	const wideStyle = isWide
		? ({ ['--portal-content-max-width' as string]: '1120px' } as React.CSSProperties)
		: undefined;

	return (
		<div
			className={clsx(ThemeClassNames.docs.docMarkdown, 'markdown')}
			style={wideStyle}
		>
			<div className="portalDocToolbar">
				<span className="portalDocToolbar__context">Developer portal</span>
				<button
					className="portalDocToolbar__copy"
					type="button"
					onClick={copyPage}
					aria-label="Copy the visible documentation page"
					aria-live="polite"
				>
					<span
						className="portalCopyIcon"
						aria-hidden="true"
					/>
					{copyLabel}
				</button>
			</div>

			{syntheticTitle && (
				<header>
					<Heading as="h1">{syntheticTitle}</Heading>
				</header>
			)}

			<aside
				className="portalProvenance"
				aria-label="Documentation provenance"
			>
				<div
					className="portalProvenance__status"
					data-status={status}
				>
					<span
						className="portalProvenance__dot"
						aria-hidden="true"
					/>
					<span>{humanize(status)}</span>
				</div>
				<div className="portalProvenance__fact">
					<span>Audience</span>
					<strong>{audiences.length > 0 ? audiences.map(humanize).join(' · ') : 'Not classified'}</strong>
				</div>
				<div className="portalProvenance__fact">
					<span>Verified</span>
					<strong>{lastVerified}</strong>
				</div>
				<details className="portalProvenance__sources">
					<summary>{sources.length === 1 ? '1 source' : `${sources.length} sources`}</summary>
					<ul>
						{sources.map((source) => (
							<li key={source}>
								<code>{source}</code>
							</li>
						))}
					</ul>
				</details>
			</aside>

			<MDXContent>{children}</MDXContent>
		</div>
	);
}
