---
title: Stock transfers
description: Stock by location, requests between locations, approval that keeps the pieces, the stock-out checklist and dispatch with a delivery challan or a branch invoice, the stock-in checklist, transit losses and carrier claims, and the books at each step.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: stock transfer branch transfer location warehouse store request approve pack dispatch receive delivery challan rule 55 branch invoice IGST e-way bill stock in transit transit loss carrier claim seal checklist cost layer FIFO
source_of_truth:
    - packages/contracts/src/transfers.ts
    - packages/core-domain/src/locations/transfer-rules.ts
    - packages/core-domain/src/ports/transfer.repository.ts
    - packages/adapters-db-mongo/src/repositories/transfer.repository.ts
    - apps/api/src/transfers
    - apps/admin/src/app/features/transfers
---

# Stock transfers

A location asks another for stock; the sender approves, packs and dispatches it; the receiver counts what arrived. The cost layers travel with the pieces, so a transfer never changes what they cost (D15). Every step writes the stock, the books and the edit log in one transaction.

## Stock by location

Stock › Stock by location lists each item's stock on hand at every active location, the location the header chip is on first and marked "(you)", what is on the way in transfers, and the total. Low and Out are the stock list's own filters across the business. Request stock opens on a row, or from the header for any item on the page.

## Steps

| Step       | Who                                | What happens                                                                                                                                                                     |
| ---------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requested  | A person at the receiving location | `TR/26-27/000019`: which item, from which location (with what it has free), how many, needed by, a note. Nothing moves.                                                          |
| Approved   | The sender (`transfer.manage`)     | The pieces are kept for the transfer at the sender (reserved: nobody else can sell them). Refused when the sender hasn't that many free. Or rejected with a reason.              |
| Packing    | The sender                         | The stock-out checklist: tick or scan every piece, seal number, boxes, photos of the sealed boxes, vehicle or courier, the e-way bill. Saved as it goes.                         |
| In transit | The sender: Dispatch               | Off until every piece is packed, the seal number is in, and the e-way bill number when the value at cost reaches the threshold (Settings › E-invoice and e-way bill). See below. |
| Received   | The receiving location             | The stock-in checklist: what arrived and how much of it is damaged, per line.                                                                                                    |
| Cancelled  | Either end, before dispatch        | With a reason; anything kept is let go.                                                                                                                                          |

## Dispatch

- The pieces leave the sender oldest first: its own cost layers, and layers from before locations when it is the default stock location. A piece with no recorded cost is refused.
- **Within one GSTIN:** a delivery challan is numbered (`DC/…`, Rule 55: not a sale), and the books move Stock in transit Dr · Stock-in-hand Cr at cost. No tax.
- **To another GSTIN (N8):** two GSTINs are two persons under GST, so it is a supply at cost with IGST on a tax invoice from the sender's own series. The sender posts Branch account Dr · Branch transfer sales Cr · Output IGST Cr, and the cost leaves its stock (Cost of goods sold Dr · Stock-in-hand Cr). Every line needs its HSN and rate.

## Receiving

- What arrived (good or damaged) enters the receiver's stock at the cost it left at: the layers are made again at the receiver with their original dates. Damaged pieces are held, not for sale.
- Short pieces are taken from the newest layers and become a **claim on the carrier** (Claims on carriers Dr) or a **transit loss** (Transit loss Dr), chosen on the checklist. The transfer reads "Received short".
- Within one GSTIN: Stock-in-hand (receiver) Dr · claim or loss Dr · Stock in transit Cr.
- Across GSTINs: Stock-in-hand Dr · Input IGST Dr on what arrived · claim or loss Dr (cost and its IGST: no input credit on lost goods) · Branch account Cr. Company reports net the branch accounts and branch transfer sales out.

Shared chart v4 adds the Transit loss and Claims on carriers ledgers; existing books receive them through the update on Settings › Accounts templates. Locking a month lists transfers that left in it and are still on the way.

## Prints

Print delivery challan (same GSTIN) or Print branch invoice (another GSTIN) on the transfer's page once it has left, from the document formats.

## API

| Method | Path                                                                        | Permission        |
| ------ | --------------------------------------------------------------------------- | ----------------- |
| GET    | `/admin/transfers/stock`                                                    | `transfer.index`  |
| GET    | `/admin/transfers`, `/:id`, `/:id/print`                                    | `transfer.index`  |
| POST   | `/admin/transfers`                                                          | `transfer.create` |
| POST   | `/:id/decide`, `/:id/pack` (with `dispatch`), `/:id/receive`, `/:id/cancel` | `transfer.manage` |

Each action also needs the person to work at the end it acts at: the sender to approve, pack and dispatch; the receiver to receive; either to cancel.

## Collections

`stockTransfers` (numbers unique), with the stock moves in `inventoryLedger` and `locationStock` (reasons `transfer_kept`, `transfer_released`, `transfer_out`, `transfer_in`), cost layers with source `transfer`, and holds for damaged pieces.
