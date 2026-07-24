# Codex FAQ Architecture and Admin Plan

> **⚠️ Reclassification (2026-07-02, reinforced 2026-07-04).** File renamed from `codex-qna-architecture-and-admin-plan.md`. Per the owner correction (`owner-decisions-log.md`, 2026-06-29 Q&A/FAQ section), **the module described here is actually the FAQ / editorial-targeting plan** (admin-curated, general/category/product/mixed targeting) — _not_ customer Q&A. Read every "Q&A" mention below as **"FAQ"**. The **true customer Q&A** module is separate: customer-submitted product questions, admin-only answers, public after admin answer, email-on-answer, guest/logged-in identity capture, editable display name/email, and a "Stay anonymous" public-display flag. Internal prose has not been mass-re-termed to avoid churn; this banner is the source of truth for the naming.

Created: 2026-06-28
Scope: **FAQ** (targeted editorial) data model, admin workflows, storefront rendering, targeting rules, SEO/i18n, moderation, contracts, and analytics. This is a planning artifact only.

---

## 1. Sources and Context

- `project-context/angular-context/fastkart-execution-plan.md` keeps Fastkart Questions-Answers UI as a replicate target.
- `project-context/angular-context/fastkart-assessment-and-plan.md` notes that Fastkart product DTOs already include reviews/ratings/Q&A style concepts.
- Current repo has admin stubs for `apps/admin/src/app/pages/questions.page.ts` and `apps/admin/src/app/pages/faqs.page.ts`.
- Current catalog plan models FAQs/content blocks separately; Q&A is related but must not be collapsed into static FAQ.

---

## 2. Positioning

FAQ is a managed editorial/content module with flexible targeting. It is different from true customer Q&A:

- FAQ: curated editorial content, usually stable, often SEO/content driven.
- True customer Q&A: customer-submitted product questions answered by admin, then published and emailed back to the asker.
- This file's old "Q&A" wording means targeted FAQ records that can be general, product-specific, category-specific, or a deliberate category-plus-product combination.

Fastkart's FAQ/Q&A-looking pages should be replicated in look/feel, but the FAQ targeting model and the separate customer Q&A workflow are Saha Textile-specific.

Locked separation:

- Admin navigation keeps **FAQ** and **Q&A** separate.
- FAQ can target global surfaces, categories, products, or mixed category+product union with dedupe/preview.
- Q&A is product-submitted, admin-answered, no community answers at launch, and sends an email notification after the answer is published.
- Both modules are translation-ready for `en` + `bn` and can reuse the same table, searchable dropdown, modal, editor, and status components.

---

## 3. Q&A Types

| Type         | Meaning                                                                  | Storefront surfaces                                                 |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| General Q&A  | Applies broadly without product/category target.                         | Home, help page, product/category fallback if configured.           |
| Product Q&A  | Applies to one or more explicit products.                                | Product detail page.                                                |
| Category Q&A | Applies to one or more categories and their descendant product listings. | Category page and product pages under that category.                |
| Mixed Q&A    | Applies to selected categories plus explicit products.                   | Union of category-derived products and explicit product selections. |

Mixed Q&A is required to reduce admin setup mistakes: if the admin selects a category and also selects a product separately, the system should deduplicate if the product already belongs to the category, and still include the product if it does not.

---

## 4. Collections

### 4.1 `questionAnswers`

Purpose: canonical Q&A record with targeting, moderation, translation, and SEO flags.

```ts
type QuestionAnswerDoc = {
	_id: string;
	question: { en: string; bn?: string };
	answerHtml: { en: string; bn?: string };
	status: 'draft' | 'pending_answer' | 'answered' | 'published' | 'rejected' | 'archived';
	scope: 'general' | 'product' | 'category' | 'mixed';
	targetCategoryIds: string[];
	includeCategoryDescendants: boolean;
	targetProductIds: string[];
	resolvedProductIdsCache?: string[];
	surfaces: Array<'product_detail' | 'category_page' | 'home' | 'help_center' | 'checkout_help'>;
	author: {
		type: 'admin' | 'customer' | 'guest' | 'imported';
		userId?: string;
		displayName?: string;
		emailHash?: string;
	};
	answeredByUserId?: string;
	moderation: {
		requiresReview: boolean;
		reviewedByUserId?: string;
		reviewedAt?: Date;
		rejectionReason?: string;
		spamScore?: number;
	};
	seo: {
		includeInStructuredData: boolean;
		noindex?: boolean;
	};
	helpful: {
		yes: number;
		no: number;
	};
	sortOrder?: number;
	createdAt: Date;
	updatedAt: Date;
	publishedAt?: Date;
	archivedAt?: Date;
};
```

Indexes:

- `{ status: 1, scope: 1, updatedAt: -1 }`.
- `{ targetCategoryIds: 1, status: 1 }`.
- `{ targetProductIds: 1, status: 1 }`.
- `{ resolvedProductIdsCache: 1, status: 1 }` if the cache is used for fast product-page lookup.

### 4.2 `questionAnswerEvents`

Purpose: lightweight Q&A analytics and moderation trace.

```ts
type QuestionAnswerEventDoc = {
	_id: string;
	questionAnswerId: string;
	eventType: 'view' | 'helpful_yes' | 'helpful_no' | 'submitted' | 'answered' | 'published' | 'rejected';
	userId?: string;
	guestId?: string;
	productId?: string;
	categoryId?: string;
	occurredAt: Date;
	expiresAt?: Date;
};
```

Rules:

- Raw event retention should be short on the launch Mongo/droplet profile.
- Roll Q&A metrics into general analytics aggregates when needed.

---

## 5. Target Resolution Rules

Effective Q&A targets are computed as:

```ts
effectiveProductIds = explicitProductIds union productsUnderSelectedCategoriesIncludingDescendants
```

Rules:

- Category selection applies to that category and descendant categories when `includeCategoryDescendants = true`.
- Explicit product selection always wins, even if the product is outside selected categories.
- Duplicate products are deduplicated by product id.
- Archived/hidden/discontinued products are suppressed from public rendering even if targeted.
- Admin preview must show: selected categories, explicit products, estimated covered products, duplicates removed, and products explicitly selected outside selected categories.

---

## 6. Admin UI Plan

### 6.1 Main Q&A list

Columns:

- Question.
- Scope.
- Target categories.
- Target products.
- Resolved product count.
- Status.
- Author.
- Updated date.
- Published date.

Filters:

- Status.
- Scope.
- Category.
- Product.
- Author type.
- Missing Bengali translation.
- Needs answer/review.

Actions:

- Create Q&A.
- Edit Q&A.
- Answer question.
- Publish/unpublish.
- Archive.
- Bulk status change.

### 6.2 Create/edit form

Fields:

- Question text: `en`, optional `bn`.
- Answer rich text: `en`, optional `bn`.
- Scope selector: general, product, category, mixed.
- Category dropdown: searchable multi-select with selected chips and remove cross button.
- Product dropdown: searchable multi-select with selected chips and remove cross button.
- Include descendant categories toggle.
- Surface checkboxes.
- SEO structured-data toggle.
- Status.
- Sort order.

Dropdown requirements:

- Reuse the same searchable select/dropdown component family used for product categories/tags.
- Category and product targeting are multi-select.
- The admin can select both categories and products in the same record.
- The form shows a live target preview and deduplication warnings.

### 6.3 Data quality guards

- Block publish if default English question or answer is missing.
- Warn when Bengali translation is missing.
- Warn if scope is product/category/mixed but no target is selected.
- Warn if all resolved targets are hidden/archived.
- Warn if explicit product is already covered by selected categories, but do not block because this can be intentional safety.
- Warn if Q&A content looks like a duplicate of an existing published record.

---

## 7. Storefront Rendering

### 7.1 Product page

Render Q&A from:

1. Product-targeted Q&A for the product.
2. Category-targeted Q&A inherited from the product's active categories.
3. General Q&A if configured for product detail surfaces.

Deduplicate by Q&A id. Recommended precedence: direct product > category inherited > general.

### 7.2 Category page

Render Q&A from:

1. Category-targeted Q&A for that category/path.
2. General Q&A if configured for category surfaces.

### 7.3 Help/home/checkout surfaces

Render only Q&A records whose `surfaces` includes the route type. Do not leak product-specific Q&A into checkout unless deliberately configured.

---

## 8. SEO and i18n

- Q&A must render server-side when used on indexable pages.
- Do not lazy-fetch indexable Q&A only after hydration.
- Use `en` and `bn` i18n objects for admin-authored content.
- If customer-submitted raw questions are accepted later, store the original locale and optionally allow admin-translated answer text.
- Structured data is emitted only for public, rendered, non-spam, meaningful Q&A content.
- Do not emit fake or duplicate schema.
- Archived Q&A is removed from public pages and structured data.

---

## 9. API and Contracts

Recommended contract families:

- `QuestionAnswer`.
- `QuestionAnswerCreateRequest`.
- `QuestionAnswerUpdateRequest`.
- `QuestionAnswerTargetPreviewRequest`.
- `QuestionAnswerTargetPreviewResponse`.
- `QuestionAnswerPublicSummary`.
- `QuestionAnswerAdminListItem`.

Recommended endpoints:

- `GET /admin/qna`.
- `POST /admin/qna`.
- `PATCH /admin/qna/:id`.
- `POST /admin/qna/:id/publish`.
- `POST /admin/qna/:id/archive`.
- `POST /admin/qna/target-preview`.
- `GET /catalog/products/:slug/qna`.
- `GET /catalog/categories/:path/qna`.

All admin routes require admin auth, CSRF, permission checks, validation, and audit logging.

---

## 10. Analytics and Reporting

Track:

- Q&A views on product/category pages.
- Helpful yes/no votes.
- Customer-submitted unanswered questions if enabled later.
- Q&A records that reduce support/contact requests if measurable.

Use analytics to identify:

- Products/categories needing better descriptions.
- Repeated questions that should become permanent FAQs.
- Search terms that indicate missing Q&A/product copy.

---

## 11. Implementation Sequence

1. Create contracts for Q&A admin/public DTOs.
2. Create `questionAnswers` and indexes.
3. Build admin Q&A list/form using Fastkart style and reusable table/dropdown/modal components.
4. Implement target preview resolver with category descendant expansion and explicit product union.
5. Add public product/category Q&A endpoints.
6. Render Q&A on product/category pages server-side.
7. Add audit logging and optional event tracking.
8. Add SEO/i18n validation gates.

---

## 12. Owner Decisions

### QUERY: Can customers submit public product questions at launch?

Recommended: admin-managed Q&A only at launch.

| Option                              | Pros                                       | Cons                                                 |
| ----------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| Admin-managed only                  | Lower moderation/spam risk; faster launch. | Less community content.                              |
| Customer submission with moderation | More authentic product questions.          | Needs spam control, moderation queue, notifications. |

### QUERY: Should inherited category Q&A show on every product under that category?

Recommended: yes, with per-Q&A surface controls and admin preview.

| Option | Pros                                                      | Cons                                          |
| ------ | --------------------------------------------------------- | --------------------------------------------- |
| Yes    | Reduces repeated setup; matches category-level knowledge. | Bad category assignment can over-display Q&A. |
| No     | Precise product pages.                                    | More admin repetition.                        |

### QUERY: Should Q&A and FAQ stay separate in admin navigation?

Recommended: separate pages, shared reusable editor components.

| Option   | Pros                                                      | Cons                                         |
| -------- | --------------------------------------------------------- | -------------------------------------------- |
| Separate | Clear distinction between editorial FAQ and targeted Q&A. | More navigation items.                       |
| Combined | One content place.                                        | Targeting/moderation rules become cluttered. |
