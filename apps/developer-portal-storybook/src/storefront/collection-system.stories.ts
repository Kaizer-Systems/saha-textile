import type { Params } from '../../../storefront/src/app/data-access/interfaces/core.interface';
import { CollectionCategories } from '../../../storefront/src/app/features/shop/collection/widgets/collection-categories/collection-categories';
import { CollectionPaginate } from '../../../storefront/src/app/features/shop/collection/widgets/collection-paginate/collection-paginate';
import { CollectionProducts } from '../../../storefront/src/app/features/shop/collection/widgets/collection-products/collection-products';
import { CollectionSort } from '../../../storefront/src/app/features/shop/collection/widgets/collection-sort/collection-sort';
import { CollectionAttributes } from '../../../storefront/src/app/features/shop/collection/widgets/filter/collection-attributes-filter/collection-attributes-filter';
import { CollectionCategoryFilter } from '../../../storefront/src/app/features/shop/collection/widgets/filter/collection-category-filter/collection-category-filter';
import { CollectionFilter } from '../../../storefront/src/app/features/shop/collection/widgets/filter/collection-filter/collection-filter';
import { CollectionPriceFilter } from '../../../storefront/src/app/features/shop/collection/widgets/filter/collection-price-filter/collection-price-filter';
import { CollectionRatingFilter } from '../../../storefront/src/app/features/shop/collection/widgets/filter/collection-rating-filter/collection-rating-filter';
import { CollectionSidebar } from '../../../storefront/src/app/features/shop/collection/widgets/sidebar/sidebar';
import { SkeletonCollectionSidebar } from '../../../storefront/src/app/features/shop/collection/widgets/skeleton-collection-sidebar/skeleton-collection-sidebar';

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

const filter: Params = {
	page: 1,
	paginate: 12,
	status: 1,
	field: '',
	price: '',
	category: '',
	tag: '',
	sort: '',
	sortBy: '',
	rating: '',
	attribute: '',
};

const activeFilter: Params = {
	...filter,
	category: 'sarees',
	price: '1200-9800',
	rating: '4',
	attribute: 'material:handloom',
};

const catalogueImports = [
	CollectionCategories,
	CollectionPaginate,
	CollectionProducts,
	CollectionSort,
	CollectionAttributes,
	CollectionCategoryFilter,
	CollectionFilter,
	CollectionPriceFilter,
	CollectionRatingFilter,
	CollectionSidebar,
	SkeletonCollectionSidebar,
];

const meta = {
	title: 'Storefront/Catalogue/Collection System',
	component: CollectionFilter,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
		docs: {
			description: {
				component:
					'Real collection, sorting, pagination, filter, sidebar, and loading components mounted against deterministic Storybook providers.',
			},
		},
	},
	decorators: [
		moduleMetadata({ imports: catalogueImports }),
		(story) => {
			const rendered = story();
			return {
				...rendered,
				template: `<div class="storybookComponentStage">${rendered.template ?? ''}</div>`,
			};
		},
	],
	args: { filter },
} satisfies Meta<CollectionFilter>;

export default meta;
type Story = StoryObj<CollectionFilter>;

export const FilterSummary: Story = {
	render: () => ({
		props: { filter: activeFilter },
		template: '<app-collection-filter [filter]="filter" />',
	}),
};

export const AttributeFacet: Story = {
	render: () => ({
		props: {
			filter,
			values: [
				{ value: 'handloom', label: 'Handloom', count: 9 },
				{ value: 'silk', label: 'Pure silk', count: 6 },
				{ value: 'festive', label: 'Festive', count: 4 },
			],
		},
		template: '<app-collection-attributes-filter facetKey="material" [values]="values" [filter]="filter" />',
	}),
};

export const CategoryFacet: Story = {
	render: () => ({
		props: { filter },
		template: '<app-collection-category-filter [filter]="filter" />',
	}),
};

export const PriceFacet: Story = {
	render: () => ({
		props: { filter },
		template: '<app-collection-price-filter [filter]="filter" />',
	}),
};

export const RatingFacet: Story = {
	render: () => ({
		props: { filter },
		template: '<app-collection-rating-filter [filter]="filter" />',
	}),
};

export const Sorting: Story = {
	render: () => ({
		props: { filter },
		template: '<app-collection-sort [filter]="filter" gridCol="4" />',
	}),
};

export const Pagination: Story = {
	render: () => ({
		props: { filter },
		template: '<app-collection-paginate [filter]="filter" />',
	}),
};

export const ProductGrid: Story = {
	render: () => ({
		props: { filter },
		template: '<app-collection-products [filter]="filter" gridCol="4" />',
	}),
};

export const CategoryRail: Story = {
	render: () => ({
		template: '<app-collection-categories title="Shop by collection" style="horizontal" />',
	}),
};

export const Sidebar: Story = {
	render: () => ({
		props: { filter },
		template: '<app-collection-sidebar [filter]="filter" />',
	}),
};

export const SidebarLoading: Story = {
	render: () => ({
		template: '<app-skeleton-collection-sidebar />',
	}),
};
