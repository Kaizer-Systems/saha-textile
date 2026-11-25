---
title: Exports
description: The Export menu on admin lists and reports, which downloads what the screen shows as CSV, Excel or PDF, made on the server.
status: implemented
audience: [backend, frontend]
last_verified: '2026-11-25'
search_keywords: export menu download csv excel xlsx pdf report list exceljs byte order mark bengali audit log accounts filters
source_of_truth:
    - packages/contracts/src/exports.ts
    - apps/api/src/exports/exports.service.ts
    - apps/admin/src/app/shared/ui/export-menu/export-menu.ts
---

# Exports

Every admin list and report that downloads data has one Export menu (`<app-export-menu>`) with CSV, Excel and PDF
(brief 25 EX1; a statement with its own printed layout, such as the balance sheet, offers CSV and Excel only through
`[formats]`). It replaced the earlier Download CSV buttons. Import templates are not exports and stay as they are.

## What a screen gives

A screen hands the menu a source: a function returning an `ExportSource` (or a promise of one, when every page must
be fetched first) with the file name without its extension, the title, the filters in force as label and value pairs,
the header, the rows (numbers as numbers, dates as `YYYY-MM-DD`) and, where needed, a column's kind (`money`). Screens
that already wrote a CSV reuse that code through `captured()`, which runs it with a stand-in writer. The export is
every row matching the screen's filters, not only the page in view, with the columns in view.

## On the server

`POST /admin/exports` (admin only) takes the format and that data (`ExportRequest`: at most 20,000 rows) and returns the
file. Nothing is read from the database, so an export can never show more than the screen did.

| Format | Made with             | Holds                                                                                                                                           |
| ------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| CSV    | the core CSV writer   | Plain numbers without ₹ or commas, ISO dates, UTF-8 with a byte-order mark so Bengali names open correctly in Excel.                            |
| Excel  | exceljs 4.4.0 (MIT)   | The company and title, the filters above the table, a frozen header, ₹ number format, dates as dates, a bold totals row, filters on the header. |
| PDF    | the document renderer | A4, portrait up to six columns and landscape above, the company, title and filters at the top, page x of y and who printed it at the foot.      |

Accounts exports (`area: 'accounts'`) are written to the audit log: who, the title, the format and the filters.
Aadhaar and bank numbers leave masked, as the screens show them.
