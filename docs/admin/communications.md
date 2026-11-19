---
title: Communications
wide: true
description: The Settings › Communications screen, the approved list of messages and channels, the rules the API applies to each switch, and how every sender obeys them.
status: implemented
audience: [beginner, frontend, backend]
last_verified: '2026-11-19'
source_of_truth:
    - packages/contracts/src/communication-use.ts
    - packages/core-domain/src/communications/communication-rules.ts
    - packages/core-domain/src/ports/communication-switch.repository.ts
    - packages/adapters-db-mongo/src/repositories/communication-switch.repository.ts
    - apps/api/src/communications
    - apps/api/src/infra/notification-factory.ts
    - packages/adapters-notifications-msg91/src/msg91-notification.adapter.ts
    - apps/admin/src/app/features/setting/communications
---

# Communications

Settings › Communications (`/setting/communications`) decides which channels carry each message the shop sends: email, SMS and WhatsApp. It is one table with a heading row per group (account and security, orders, shop updates, marketing) and one switch per message and channel.

Reading needs `setting.index`; changing a switch needs `setting.edit`. The routes are `GET` and `PUT /admin/communications`.

## The list of messages

`COMMUNICATION_USES` in `packages/contracts/src/communication-use.ts` holds the twenty-two approved messages: the twenty approved on 2026-11-13, plus an item on backorder and an item sold out before payment (order refunded), added from the 2026-11-17 orders decisions. The list is fixed in code because each row is a message the code actually sends; the admin only switches channels on and off. Each cell has:

| Field       | Meaning                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `available` | False when the channel cannot carry the message at all (the newsletter is email only)     |
| `on`        | The recommended start state                                                               |
| `risk`      | `none`, `warning` (cost, promotional route or marketing rate) or `danger` (security risk) |
| `reasonKey` | Translation key of the reason shown on the i mark and in the password popup               |

The red (`danger`) cells are email verification and staff invitation by SMS or WhatsApp. They stay off and cannot be switched on: both links prove that a person owns an email address, and sending them to a phone would skip that proof.

## Stored state

`communicationSwitches` holds one row per message and channel that an operator changed, with `_id` `<use>.<channel>`, the new state, who changed it and when. A missing row means the recommended start state, so a new database behaves like the approved table without seeding. A red or unavailable cell reads as off whatever a row says: the lock is part of the rule, not of the data.

## Rules for a change

`decideCommunicationChange` in core decides every change; the API applies the same decision whatever the page sends.

- **Turning on a yellow cell** needs the operator's password. The API checks it with the same recent-password proof as Security Settings (`AdminSecurityService.confirmCurrentPassword`). The PIN is never accepted, whatever the operator's preferred sign-in method. A missing or wrong password answers `403 Invalid credentials`, never `401`, so the session is not signed out.
- **Turning off any cell**, and turning on a cell with no warning, needs no password.
- **Red and unavailable cells** are refused (`locked`, `unavailable`).
- **Code rows** (sign-up, sign-in, code before a sensitive change, code to a new email or mobile number): email cannot be turned off (`email_required`), and SMS and WhatsApp cannot both be off (`phone_channel_required`).

A refusal is a domain refusal: `400` with one issue whose `path` is `request` and whose `code` is the rule. The page shows its own translated sentence for each code. Every change that moves a switch writes an audit row, `communication.switch.change`, with the cell, the old and new state and whether a password was confirmed. The password itself is never stored or logged.

## Senders obey the switches

`CommunicationSendGate` maps the template a sender uses to its message and reads the switch:

| Template                                     | Message                                |
| -------------------------------------------- | -------------------------------------- |
| `otp_register`, `otp_login`                  | `signup_code`, `signin_code`           |
| `otp_step_up`, `otp_change_contact`          | `step_up_code`, `new_contact_code`     |
| `contact_change_requested`                   | `contact_change_warning`               |
| `customer_activation`                        | `account_activation`                   |
| `password_reset`, `verify_email`             | `password_reset`, `email_verification` |
| `admin_invite`                               | `staff_invitation`                     |
| `product_question_answered`, `back_in_stock` | `question_answered`, `back_in_stock`   |
| `shop_event_announcement`                    | `sale_launch_announcement`             |

`buildNotificationPort` gives the gate to both senders, in the API and in the worker. The MSG91 sender checks the channel kill switch from Notification settings first, which still wins, then the gate; a message switched off is recorded in the outbox as `suppressed_use_disabled` and MSG91 is never called. The console sender used in development logs the same decision and returns the same status. A template not in the table is never gated.

## The page

The page reads the table from the API with TanStack Query (`injectCommunicationSettingsQuery`) and changes one cell at a time through `AdminCommunicationsGateway`. The answer to each change is the whole table as stored, which replaces the cached copy. A switch shows the stored state until the server agrees.

- A yellow i or red i sits at the switch's top right; its translated hover name is the reason.
- Turning on a yellow cell opens the password popup (built from the idle-lock modal pieces). A wrong password shows in the popup and the popup stays open.
- Red cells are disabled switches.
- Other refusals show as an error notice.

The table keeps its first column in place on narrow screens with the shared `table-sticky-first` class in `components/_table.scss`, with a dark-mode override in `themes/_dark.scss`.
