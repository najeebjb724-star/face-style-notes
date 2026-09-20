# Photo lifecycle timer

Deploy `lifecycleJobs` with server-side dependency installation, then deploy the
timer trigger separately in WeChat DevTools using the checked-in `config.json`.
The seven-field cron `0 */1 * * * * *` requests a run every minute. See the
[CloudBase timer documentation](https://docs.cloudbase.net/cloud-function/timer-trigger).
No AppID, environment ID or secret is stored here. Disable ordinary client
invocation in function permissions; the handler also ignores all event file IDs
and timestamps and only uses server records and the server clock.

The timer processes at most 50 photo candidates per invocation. Queries select
due records before limiting; retries are ordered by due time and use one-minute
retry intervals. Three failed attempts mark `manual_review`, emit a sanitized
error event, and continue automatic attempts. `deleted` is recorded only after
the exact file's SDK result reports status 0. No SDK error strings or URLs are
logged. A one-minute deletion lease limits overlapping invocations; set the
function timeout below that lease and verify the selected environment's limits.

Create the compound indexes requested by CloudBase for these predicates before
enabling the timer: deletion_jobs(state, dueAt); analysis_jobs(sourcePhotoStatus,
deleteBy), analysis_jobs(sourcePhotoStatus, status, leaseExpiresAt);
analysis_uploads(status, deleteBy); challenges(status, photosCleaned, completedAt);
challenge_photos(challengeId, _openid, deletionState, retentionPolicy).
Keep all these collections server-write-only.

The production entries wrap the business database contract with
`adaptCloudDatabase`: every ordinary and transactional set/update is sent to
wx-server-sdk as `{ data: record }`. This fixes the flat-payload mismatch found
in the existing analysis/challenge entries. Local tests cover the SDK envelope;
live deployment still must verify transaction reads/queries, indexes, permissions,
and atomic commit behavior against the selected CloudBase environment.

Operations must configure alerts on `PHOTO_DELETE_FAILED` / `LIFECYCLE_JOB_FAILED`,
any `manual_review` record, an absent timer heartbeat for two minutes, and oldest
undeleted original approaching its 30-minute deadline. An operator must inspect
the server-owned record and exact storage object, fix permissions/outages, retry
the deletion, and confirm the object is absent before closing the incident.
Do not mark a record deleted merely to silence an alert. Monitor backlog and
increase processing capacity before the 50-item bound causes deadline misses.

Release gate CLOSED: local tests validate logic, not a deployed 30-minute SLA.
Run live success/failure/cancellation/timeout tests, force per-file storage
failures, verify retries and alert delivery, and measure actual timer cadence
under backlog and outage conditions before claiming the confirmed retention
promise. A one-minute cron after a 30-minute due time alone is not a hard
30-minute guarantee; a deployment must prove deadline-safe timing/capacity or
add storage-level expiry.

A second hard privacy blocker exists before attachment: if the device uploads
successfully but disappears before `attachUpload`, analysis_uploads has only the
server path and no exact file ID. The worker refuses to invent a cloud file ID,
flags repeated failures for manual review, and cannot prove that orphan was
deleted. Production requires a server-known exact ID before upload or a proven
server-side storage inventory/expiry mechanism. This is not covered by a passing
local deletion test and must be closed before launch.

Challenge-photo upload and persistence are not implemented yet: the current
client only previews photos locally and `challengeApi` has no
`challenge_photos` create/read action. Enable challenge-photo retention only
after that owner-scoped upload bridge persists server-issued exact `fileId`,
`challengeId`, `_openid`, and optional `retentionPolicy: "keep"`. Completion
stores `photoDeleteBy` at the trusted completion instant plus seven days; legacy
date-only records fall back to completedAt plus seven days. Deleting a challenge
stores a durable owner-scoped deletion intent before removing it, deletes its
photos immediately in a bounded batch (including kept photos), and lets the timer
finish/retry the remainder. Other owners' records are excluded.
