# Master Search implementation

Master keeps its default date-bounded browsing mode. A normalized search term of
at least three characters enables all-date search across the primary Booking ID,
Add Nights/channel Booking IDs, and guest-name prefixes. Room, channel, status,
and an explicitly enabled date range can still refine those results.

The API caps all-date search pages at 50 records, applies a two-second MongoDB
query budget, and does not calculate live occupancy for Master requests.

## Production migration

The search fields are derived and do not replace any booking data. New and
edited bookings maintain them automatically. Existing records must be backfilled
before enabling the all-date UI in production:

```sh
cd api
pnpm build
RUN_MASTER_SEARCH_INDEX_MIGRATION=true pnpm migrate:master-search-indexes
```

The guarded migration:

1. reads only Booking ID, guest name, and channel Booking IDs;
2. writes normalized search arrays with the native MongoDB cursor in batches of
   100;
3. creates the three search indexes and the date-browsing index without using
   unique constraints;
4. prints scanned and modified counts plus the resulting index names.

Take or verify a recent database backup first, run during a quiet period, and
confirm the printed counts before deploying the frontend.
