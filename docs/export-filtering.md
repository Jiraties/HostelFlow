# Booking export filters

The Documents booking card uses compact dropdowns with native checkbox choices, search, selected counts, and Select All / Clear All inside the menu. It reuses the application font, input surfaces, checkbox treatment, and primary export button. Labels remain visible when menus are closed.

## Defaults and scope

Each new session selects all canonical booking channels, payment methods, and data categories. Cancelled is excluded by default. No-Show and Void remain selected, preserving their previous inclusion while exposing them as separate choices. A voided booking belongs to the Void filter bucket regardless of its stored lifecycle status.

Within one filter, choices combine with OR; different filters combine with AND. Clearing any dimension disables export in the UI. The API returns a valid header-only workbook for an explicit empty dimension, never all data.

This is a **booking check-in-month export**, not a cash-receipts report. The existing Bangkok month bounds, booking start-date selection, and commercial-segment overlap behavior remain. Service rows belong to the selected bookings; their transaction dates do not redefine the export month. Standalone sales have no booking status/channel and remain outside this export. Immigration and hotel accommodation reports retain their existing date-only filters and passport-access rules.

## Categories and amounts

Room classification uses the backend inventory's explicit `category` field. Its private/dorm distinction matches the existing Analytics classification: Balcony, Window, and Pottery are private rooms; the numbered bed inventory is dormitory inventory. Selecting a whole dorm does not turn it into a private-room charge.

Service types come from `EXPECTED_STAY_REVENUE_SERVICE_TYPES`. Financial adjustments and surcharges linked to a service stay in the services category. Other booking financial adjustments stay with accommodation; money movements and deposits follow the existing export revenue helper rather than being counted as extra revenue.

One commercial accommodation charge remains one row, even if it spans several rooms or both room categories. Mixed private/dorm rows keep the full charge **once**, with a separate Mixed label and explanatory note. Selecting private or dorm includes such rows, clearly classified as Mixed; it does not claim that the full amount belongs exclusively to the selected room type. No capacity-based price split or estimated monetary amount is introduced. Unknown or missing room inventory is labeled unclassified and retained when accommodation is selected, rather than silently losing its amount.

The model has no per-room prices. Exact separate private/dorm revenue for a mixed charge cannot be recovered from this export. Owners should keep Mixed and unclassified groups separate in pivots and trends.

## Workbook row granularity

The `Bookings` sheet retains the original thirteen columns, with four additive columns:

| Column | Purpose |
| --- | --- |
| ประเภทข้อมูล | Private, dorm, services, Mixed, or unclassified |
| ชนิดแถว | Accommodation segment, service transaction, or related adjustment |
| รหัสการจองหลัก | Stable parent booking ID for distinct booking counts, including extensions with channel-specific IDs |
| รหัสรายการต้นทาง | Commercial segment or transaction ID to identify the source row |

Each room-charge segment appears once. Each eligible non-room revenue/reduction transaction appears once. Effective transaction corrections are applied before filtering. Settlement receipts do not duplicate their original charge; deposits remain in the separate collected-deposit column and are not added to the amount total.

For pre-arrival cancellations, an unpaid room charge includes a report-only negative row for its uncollected balance. It is labeled as a calculated cancellation adjustment, not a cash refund. Linked payments and existing write-offs are deducted before calculating that row, and retained or refunded payments continue to use their recorded transactions. Void and cancelled stays resolved after check-in do not receive this inferred adjustment. For legacy bookings with multiple unpaid room charges and unlinked room payments or write-offs, the report cannot reliably assign the adjustment to a segment; those bookings require manual review.

Channel and payment filters apply to the **row's own** commercial channel and recorded payment method. A Card service does not admit an unrelated Cash room charge. Payment filtering is not a query for the payment methods later used to settle an originally Unpaid charge. Legacy accommodation without a linked payment record is retained only when all methods are selected and keeps a blank method.

The separate `Export Info` sheet records selections, distinct booking count, row count, amount totals, collected deposits, category totals, and interpretation notes. Pivot sums use the amount column; booking counts use distinct parent booking IDs. Only accommodation rows carry night counts; service/adjustment rows leave nights blank to avoid duplicating nights in pivots. Void amounts remain review information, not operating revenue.

## Additive API contract

Endpoint: `GET /documents/getBookingsReport`, under the existing authenticated Documents router.

New clients send `filterVersion=2`, `month=YYYY-MM`, and:

| Parameter | Values |
| --- | --- |
| `bookingChannels` | Existing canonical platform IDs |
| `bookingStatuses` | Model status enum plus `voided` |
| `paymentMethods` | Transaction schema payment-method enum |
| `categories` | `private`, `dorm`, `services` |

Selections may be comma-separated strings or repeated parameters. An explicit empty string means none. Omitted dimensions use the new-session defaults. Unsupported values, nested objects, conflicting singular/plural parameters, and unsupported filter versions return HTTP 400.

Legacy callers using only `bookingChannel`, `bookingStatus`, and `paymentMethod` retain the original workbook layout, defaults, and booking-level payment matching. A partially migrated request can combine plural dimensions with singular dimensions; legacy `all` keeps its explicit all-selected meaning. Existing consumers found in the repository are the Documents page and reporting tests.

## Verification

`api/tests/exportFilters.test.ts` checks parsing, defaults, canonical values, status separation, classification, invalid input, empty selections, and legacy dispatch. `api/tests/bookingExportFilters.integration.test.ts` exercises the controller against a disposable local MongoDB and reloads the actual Excel bytes to check combined filters, categories, mixed records, totals, deposits, linked services, extensions, and the legacy workbook. All fixture records are fabricated.

`api/tests/exportFiltersFrontend.unit.test.ts` executes the actual frontend helpers and verifies their canonical defaults, multiselection serialization, and empty-array behavior against the backend parser.

## Files changed

| File | Change |
| --- | --- |
| `frontend/src/pages/Documents.tsx` | Booking-card selection state and versioned export query |
| `frontend/src/pages/Documents.css` | Compact helper text and labels |
| `frontend/src/components/ExportMultiSelect.tsx` | Reusable dropdown with search, native checkboxes, selection counts, bulk selection, outside-click/Escape closing, and focus handling |
| `frontend/src/components/ExportMultiSelect.css` | Dropdown surface, scroll area, focus styling, and touch targets |
| `frontend/src/helpers/exportFilters.ts` | Default selections, options, empty-selection check, and query serialization |
| `api/src/config/roomInventory.ts` | Explicit private/dorm classification on the existing inventory |
| `api/src/helpers/exportFilters.ts` | Shared canonical validation, defaults, and legacy/new request dispatch |
| `api/src/helpers/bookingExportRows.ts` | Effective transaction projection, row classification, and row-level filtering |
| `api/src/controller/documents.ts` | Additive filter path, workbook metadata, and pivot columns; preserves the legacy path |
| `api/tests/exportFilters.test.ts` | Parser and classification unit tests |
| `api/tests/exportFiltersFrontend.unit.test.ts` | Frontend-to-backend selection contract tests |
| `api/tests/bookingExportFilters.integration.test.ts` | Database-to-Excel integration tests |
| `docs/export-filtering.md` | Behavior, limitations, and implementation reference |

The tracked API JavaScript and source maps under `api/dist/` are regenerated by `pnpm --dir api build` for the changed source files. No dependencies or lockfiles change.
