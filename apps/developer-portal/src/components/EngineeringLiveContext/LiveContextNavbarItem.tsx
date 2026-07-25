import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from '@docusaurus/Link';
import { usePluginData } from '@docusaurus/useGlobalData';
import clsx from 'clsx';

import styles from './styles.module.css';

type LiveDocument = {
	title: string;
	path: string;
	lastVerified?: string;
};

type LiveContextData = {
	rootPath: string;
	generatedAt: string;
	documents: LiveDocument[];
};

type PortalSearchData = {
	liveContext?: LiveContextData;
};

type Props = {
	className?: string;
	label?: string;
	mobile?: boolean;
};

function displayBuildTime(value: string | undefined): string {
	if (!value) return 'Not available';
	const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
	return match ? `${match[1]} ${match[2]} UTC` : value;
}

export default function LiveContextNavbarItem({ className, label = 'LIVE', mobile }: Props): React.ReactNode {
	const pluginData = usePluginData('portal-search-plugin') as PortalSearchData | undefined;
	const liveContext = pluginData?.liveContext;
	const documents = useMemo(() => liveContext?.documents ?? [], [liveContext]);
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const popoverId = useId();

	useEffect(() => {
		if (!open) return;

		function closeOnOutsidePointer(event: PointerEvent) {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
		}

		function closeOnEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') setOpen(false);
		}

		document.addEventListener('pointerdown', closeOnOutsidePointer);
		document.addEventListener('keydown', closeOnEscape);
		return () => {
			document.removeEventListener('pointerdown', closeOnOutsidePointer);
			document.removeEventListener('keydown', closeOnEscape);
		};
	}, [open]);

	return (
		<div
			ref={containerRef}
			className={clsx(styles.container, mobile && styles.mobile, className)}
		>
			<button
				type="button"
				className={styles.trigger}
				aria-label={`Open Engineering Live Context (${documents.length} canonical documents)`}
				aria-expanded={open}
				aria-controls={popoverId}
				onClick={() => setOpen((value) => !value)}
			>
				<span
					className={styles.pulse}
					aria-hidden="true"
				/>
				<span>{label}</span>
				<small>{documents.length}</small>
			</button>

			{open && (
				<section
					id={popoverId}
					className={styles.popover}
					aria-label="Engineering Live Context documents"
				>
					<header className={styles.header}>
						<div>
							<span className={styles.eyebrow}>Build-indexed source of truth</span>
							<strong>Engineering Live Context</strong>
						</div>
						<span className={styles.count}>{documents.length} files</span>
					</header>

					<nav
						className={styles.documentList}
						aria-label="Canonical engineering documents"
					>
						{documents.map((document) => (
							<Link
								key={document.path}
								className={styles.documentLink}
								to={document.path}
								onClick={() => setOpen(false)}
							>
								<span>{document.title}</span>
								<small>
									{document.lastVerified
										? `Verified ${document.lastVerified}`
										: 'Verification pending'}
								</small>
							</Link>
						))}
					</nav>

					<footer className={styles.footer}>
						<span>Index built {displayBuildTime(liveContext?.generatedAt)}</span>
						<Link
							to={liveContext?.rootPath ?? '/engineering-live-context'}
							onClick={() => setOpen(false)}
						>
							Open index
						</Link>
					</footer>
				</section>
			)}
		</div>
	);
}
