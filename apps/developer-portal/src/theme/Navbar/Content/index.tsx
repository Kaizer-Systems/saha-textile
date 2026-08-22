import React from 'react';
import clsx from 'clsx';
import { ErrorCauseBoundary, ThemeClassNames, useThemeConfig } from '@docusaurus/theme-common';
import { splitNavbarItems, useNavbarMobileSidebar } from '@docusaurus/theme-common/internal';
import NavbarColorModeToggle from '@theme/Navbar/ColorModeToggle';
import NavbarItem from '@theme/NavbarItem';
import NavbarLogo from '@theme/Navbar/Logo';
import NavbarMobileSidebarToggle from '@theme/Navbar/MobileSidebar/Toggle';
import NavbarSearch from '@theme/Navbar/Search';
import SearchBar from '@theme/SearchBar';

import { PortalLockButton } from '@site/src/components/PortalLockButton';

import styles from './styles.module.css';

type NavbarItemConfig = ReturnType<typeof useThemeConfig>['navbar']['items'][number];
type NavbarItemProps = React.ComponentProps<typeof NavbarItem>;

function useNavbarItems(): ReturnType<typeof useThemeConfig>['navbar']['items'] {
	return useThemeConfig().navbar.items;
}

function NavbarItems({ items }: { items: readonly NavbarItemConfig[] }): React.ReactNode {
	return (
		<>
			{items.map((item, index) => (
				<ErrorCauseBoundary
					key={index}
					onError={(error) =>
						new Error(
							`A theme navbar item failed to render. Please check: ${JSON.stringify(item, null, 2)}`,
							{ cause: error },
						)
					}
				>
					<NavbarItem {...(item as NavbarItemProps)} />
				</ErrorCauseBoundary>
			))}
		</>
	);
}

function NavbarContentLayout({ left, right }: { left: React.ReactNode; right: React.ReactNode }): React.ReactNode {
	return (
		<div className="navbar__inner">
			<div className={clsx(ThemeClassNames.layout.navbar.containerLeft, 'navbar__items')}>{left}</div>
			<div className={clsx(ThemeClassNames.layout.navbar.containerRight, 'navbar__items navbar__items--right')}>
				{right}
			</div>
		</div>
	);
}

export default function NavbarContent(): React.ReactNode {
	const mobileSidebar = useNavbarMobileSidebar();
	const items = useNavbarItems();
	const [leftItems, rightItems] = splitNavbarItems(items);
	const searchBarItem = items.find((item) => item.type === 'search');

	return (
		<NavbarContentLayout
			left={
				<>
					{!mobileSidebar.disabled && <NavbarMobileSidebarToggle />}
					<NavbarLogo />
					<NavbarItems items={leftItems} />
				</>
			}
			right={
				<>
					<NavbarItems items={rightItems} />
					<NavbarColorModeToggle className={styles.colorModeToggle} />
					<span className={styles.desktopLock}>
						<PortalLockButton />
					</span>
					{!searchBarItem && (
						<NavbarSearch>
							<SearchBar />
						</NavbarSearch>
					)}
				</>
			}
		/>
	);
}
