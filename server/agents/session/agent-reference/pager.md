# Pager

Page your manager when something needs a person and cannot wait for them to look at the office: a production incident, a stuck deploy that needs a decision, a credential that expired. Do not page for progress, all-clears, or anything a chat message covers; your manager may be asleep.

- `POST /api/pager` with your bearer token and `{"title": "...", "body": "...", "key": "..."}` raises a page to your manager. `title` is required (one line, up to 200 characters); `body` (up to 2000) and `key` are optional.
- `key` deduplicates: raising again with the key of your still-unresolved page updates that page (new text, raise count + 1) instead of opening another. Use a stable key per incident, such as `deploy-failed:api`. A re-raise never re-opens a page your manager acked.
- `POST /api/pager/resolve` with `{"key": "..."}` or `{"id": "..."}` resolves your own page when the problem goes away. Your manager gets a short "resolved" note.

The page shows in the office's pager view and, if your manager set up Discord delivery, is sent there and repeated until they ack or resolve it. You cannot choose who receives it.

Apps page the same way with their own token: `POST /api/app/page` and `POST /api/app/page/resolve` with `Authorization: Bearer $BUREAU_APP_TOKEN`. The page goes to the app's owner, and it still arrives if you, the agent that built the app, are down. A source can open at most 20 new pages an hour; re-raises by key do not count.

```sh
curl -s -X POST localhost:$PORT/api/pager -H "Authorization: Bearer $BUREAU_AGENT_TOKEN" -H 'Content-Type: application/json' -d '{"title":"Checkout API is returning 500s","body":"Error rate 38% since 03:12. Rollback needs your approval.","key":"checkout-500s"}'
curl -s -X POST localhost:$PORT/api/pager/resolve -H "Authorization: Bearer $BUREAU_AGENT_TOKEN" -H 'Content-Type: application/json' -d '{"key":"checkout-500s"}'
```
