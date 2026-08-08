# Global search query-plan evidence

Captured on 2026-08-08 against the current 261-booking dataset with MongoDB
`explain("executionStats")`. Values below use non-sensitive representative
clauses and a result limit of six.

| Query shape | Returned | Docs examined | Keys examined | Execution ms | Winning index |
| --- | ---: | ---: | ---: | ---: | --- |
| Exact primary booking ID | 1 | 1 | 1 | 0 | `bookingId_1` |
| Exact normalized booking/confirmation ID | 1 | 1 | 1 | 1 | `master_search_booking_ids` |
| OTA/booking ID prefix | 3 | 3 | 3 | 1 | `master_search_booking_id_prefixes` |
| Guest-name prefix | 1 | 1 | 1 | 1 | `master_search_name_prefixes` |
| Room ID | 6 | 138 | 0 | 0 | Collection scan |
| Channel | 6 | 11 | 0 | 0 | Collection scan |
| Booking check-in/check-out date | 6 | 7 | 0 | 0 | Collection scan |
| Transaction amount via `$elemMatch` | 6 | 10 | 0 | 0 | Collection scan |
| Transaction type via `$elemMatch` | 6 | 8 | 0 | 0 | Collection scan |
| Transaction `createdAt` via `$elemMatch` | 6 | 9 | 0 | 0 | Collection scan |
| Combined amount/type/date via one `$elemMatch` | 6 | 27 | 0 | 0 | Collection scan |
| Guest name plus transaction amount | 1 | 1 | 1 | 0 | `master_search_name_prefixes` |
| Room plus transaction type | 6 | 155 | 0 | 0 | Collection scan |

No new index is justified for v1 at the current scale. The room-led scans have
the highest examined-to-returned ratios, but they still completed below the
measurement resolution and scan only the small booking collection. Re-run this
matrix after material collection growth or when observed search p95 exceeds
400 ms. Add an index only when the repeated production-shaped evidence shows a
clear benefit, then capture the before/after plans here.
