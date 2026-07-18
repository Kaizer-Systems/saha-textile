---
title: Database Overview
description: Database documentation strategy.
---

# Database overview

Database documentation should be generated from schema and index sources where practical. Manual pages should explain modeling choices, lifecycle rules, retention, and migration procedure.

## Planned generated catalogue

| Section                      | Source                         |
| ---------------------------- | ------------------------------ |
| Collection fields            | Mongo schema definitions       |
| Required and nullable fields | Schema validation rules        |
| Indexes                      | Adapter index definitions      |
| Example documents            | Sanitized generated examples   |
| DTO mappings                 | Contracts plus adapter mappers |

Do not manually duplicate field tables once generation is available.
