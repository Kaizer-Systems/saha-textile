import type { IBlog } from '../../../storefront/src/app/data-access/interfaces/blog.interface';

const CDN = 'https://saha-textile-media.sgp1.cdn.digitaloceanspaces.com/media';

const cover = (path: string, alt: string): IBlog['blog_thumbnail'] => ({
	original_url: `${CDN}/${path}`,
	srcset: `${CDN}/${path} 800w`,
	alt,
	width: 1774,
	height: 887,
});

const post = (
	fields: Pick<IBlog, 'id' | 'slug' | 'title' | 'description' | 'blog_thumbnail' | 'categories'>,
): IBlog => ({
	...fields,
	content: '',
	author: 'Saha Textile',
	published_at: '2026-11-08T11:50:00.000Z',
	created_at: '2026-11-08T11:50:00.000Z',
	updated_at: '2026-11-08T11:50:00.000Z',
	reading_minutes: 7,
	share_image: null,
	tags: [],
	is_featured: false,
	is_sticky: 0,
	seo_title: `${fields.title} | Saha Textile`,
	seo_description: fields.description,
});

/** Three of the shop's own posts, in the shape the blog cards read. */
export const blogPosts: IBlog[] = [
	post({
		id: 'blg_7a99f005-de0a-4fec-996d-fc2319e2d730',
		slug: 'how-to-spot-real-banarasi',
		title: 'How to spot a real Banarasi saree: seven checks before you buy',
		description:
			'Silk Mark, the back of the weave, real or tested zari, the thread test, weight and fall: seven simple checks that tell a handwoven Banarasi from a copy, and what a fair price looks like.',
		blog_thumbnail: cover(
			'med_6d45b63f-f2de-48e3-a14b-5cff50f05247/1-real-banarasi-loupe-blog-800w-11f56ceb.webp',
			"The back of a red Katan Banarasi saree with gold zari and a brass jeweller's loupe on a wooden table",
		),
		categories: [{ slug: 'saree-guides', name: 'Saree guides' }],
	}),
	post({
		id: 'blg_5f67fd39-9c76-482a-85ed-dc491b4468ce',
		slug: 'dhakai-jamdani-vs-tangail',
		title: 'Dhakai Jamdani or Tangail: telling two Bengal weaves apart',
		description:
			'What makes a saree a Jamdani, how Dhakai differs from Tangail and from the Jamdani woven in West Bengal, how to read thread count, and which to wear to the office, Pujo or a wedding.',
		blog_thumbnail: cover(
			'med_8367de90-9aa3-4016-84e0-76cda1d75fc6/2-dhakai-vs-tangail-jamdani-blog-800w-8cee7088.webp',
			'An ivory Dhakai Jamdani with dense white motifs beside a pale blue Tangail with woven flowers on a cane stool',
		),
		categories: [{ slug: 'saree-guides', name: 'Saree guides' }],
	}),
	post({
		id: 'blg_df57bc1b-04b4-432d-88c3-8504c910615d',
		slug: 'bengali-bridal-saree-guide',
		title: 'Choosing a Bengali bridal saree: Benarasi, Kanjivaram or Baluchari',
		description:
			'A ceremony-by-ceremony guide for Bengali brides and their families: which weave suits the Ashirbad, the Biye and the Bou Bhaat, how to think about colour and weight, and how early to start.',
		blog_thumbnail: cover(
			'med_37b1190a-b226-4d9b-bbc1-4654edb44f55/3-bengali-bridal-saree-blog-800w-f441642b.webp',
			'A red Benarasi, a gold Kanjivaram and a navy Baluchari with a story pallu draped over a carved wooden chair with marigolds',
		),
		categories: [{ slug: 'weddings-and-festivals', name: 'Weddings and festivals' }],
	}),
];
