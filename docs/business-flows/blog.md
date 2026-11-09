---
title: Blog
description: How blog posts, categories and tags are written in the admin, checked for every language, published and read by the shop.
status: implemented
audience: [frontend, backend, operator]
last_verified: '2026-11-10'
source_of_truth:
    - packages/contracts/src/blog.ts
    - packages/core-domain/src/blog
    - packages/adapters-db-mongo/src/models/blog.model.ts
    - apps/api/src/blog
    - apps/admin/src/app/features/blog
    - apps/storefront/src/app/features/blog
---

# Blog

The shop's blog holds posts, blog categories and blog tags. Every text is stored per language (`{ en, bn }`), and nothing reaches the shop until every active language is complete, the same rule products follow.

## Data

| Collection       | Holds                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blogPosts`      | Title, summary, sanitised article, cover and share picture, categories, tags, byline, publish date, search title and description, featured and sticky flags, `draft` or `live` |
| `blogCategories` | Name and description per language, address, display order, `draft` or `live`                                                                                                   |
| `blogTags`       | Name and description per language, address, `draft` or `live`                                                                                                                  |

A post's address is made from its English title and is the same in both languages. Changing it leaves a permanent redirect from the old address in `seoRedirects`, and earlier addresses jump straight to the new one. Deleting a post that was ever published leaves its address answering 410.

The cover and share picture are media library assets uploaded with the Blog purpose (2:1, 2400 × 1200 recommended). Both are registered in the media owner registry through `blogPosts.assetIds`, so garbage collection never removes a picture a post uses. The cover's alt text, title and caption are written to the picture itself, so every place it shows reads the same words.

## Article markup

`sanitizeArticleHtml` in core-domain rebuilds the article from an allowlist: paragraphs, headings (`h1` becomes `h2`, so the page keeps one main heading), lists, emphasis, quotes, tables, figures, links and pictures. Links may point at the web, mail, a phone number, a shop address or a place on the page; pictures must be `https`. Everything else, including scripts, styles, frames and event handlers, is dropped. The API sanitises on every save; the storefront renders the result through Angular's own sanitiser as well.

## Go Live

`blogGoLiveGaps` lists what stops a post going live:

- a title and an article in every language;
- any summary, byline, search title or search description written in English, also written in every other language;
- a processed cover with alt text in every language;
- at least one live category, and every chosen category and tag live.

The form's Go Live button and the list's switch both call `POST /admin/blog/posts/:id/go-live` and show the same gap list. Going live sets the publish date when it is empty; the owner may back-date it, or set a later date to schedule the post. An edit that would empty a language of a live post is refused with the same gaps. A blog category or tag goes live from its status switch, and only with a name in every language.

## API

Public reads, in the language named by `?locale=`:

- `GET /catalog/blog/posts` with `page`, `pageSize`, `category`, `tag`: live posts whose publish date has come, sticky first, then newest.
- `GET /catalog/blog/posts/:slug`: one live post with its article, search title (default: the title followed by `| Saha Textile`), search description (default: the summary) and share picture (default: the cover).
- `GET /catalog/blog/categories` and `GET /catalog/blog/tags`: live terms that hold a live post, with counts.

Admin writes under `/admin/blog` use the `blog.*` permissions for posts and `category.*` and `tag.*` for blog categories and tags, the codes the admin screens already check. Every write leaves an audit record with entity type `blog`.

Live posts join `GET /catalog/sitemap` once per language, so the sitemap pairs each English address with its Bengali one.

## Admin

The admin's blog screens read and write the API. The post form uses the shared Language switch for every language-bound field (title, summary, article, byline, cover alt, title and caption, search title and description); the address, pictures, categories, tags, featured, sticky and publish date are shared. Blog categories reuse the category screen without the product-only fields; blog tags reuse the tag screen with an address field.

The post list has two bulk buttons. **Go Live** runs the form's check on each ticked post and names what stops any of them. **Take off shop** turns ticked live posts back into drafts. Both ask for confirmation first.

## Shop

- `/blogs`: the "Blog list" layout with the left sidebar (recent posts, categories, tags), ten posts a page. A category or tag filter comes from `?category=` or `?tag=`.
- `/blog/:slug`: cover, title, byline and date over the article, with the left sidebar on larger screens.
- The home page's blog rail shows the newest live posts, sticky first. The header's blog menu shows the two newest, and its "Blog details" link opens the newest post.

Dates show day, month and year in Kolkata time, never the time of day; Bengali pages keep English digits. Each page sends its own title, description, canonical address, `hreflang` pairs and `og:url`. The post page also sends `og:type` `article` with its dates and tags, and `BlogPosting` and `BreadcrumbList` structured data; the list sends a `BreadcrumbList`.
