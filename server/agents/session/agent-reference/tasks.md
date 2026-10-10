# Task Board

Use the task board only when the boss asks.

- `GET /api/tasks` lists active tasks.
- `GET /api/tasks?status=all` includes done, obsolete and backlog.
- `GET /api/tasks?status=backlog` lists backlog only.
- `POST /api/tasks` creates a task. Optional fields: `description`, `priority`, `assignee`, and `roomId`.
- `PATCH /api/tasks/<id>` updates a task. Send the `version` from your last read of the task; a stale version is a 409 carrying the current task, so re-read and retry.
- `POST /api/tasks/<id>/claim` claims an unheld task, or one you already hold. A task held by someone else is a 409 `task held`; reassigning is a `PATCH` of `assignee` with the task's version.
- `POST /api/tasks/<id>/done` marks it done.
- `DELETE /api/tasks/<id>` deletes it when your token has access.

Omit `roomId` to file in your current room. Use `roomId:""` for office-wide globals.

Close abandoned or superseded work with `PATCH {"status":"obsolete","description":"Reason for closing"}`. Done means the requested work was completed. Obsolete tasks remain readable and can be reopened; default active lists exclude them.
