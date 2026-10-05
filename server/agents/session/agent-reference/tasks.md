# Task Board

Use the task board only when the boss asks.

- `GET /api/tasks` lists active tasks.
- `GET /api/tasks?status=all` includes done and backlog.
- `GET /api/tasks?status=backlog` lists backlog only.
- `POST /api/tasks` creates a task. Optional fields: `description`, `priority`, `assignee`, and `roomId`.
- `PATCH /api/tasks/<id>` updates a task.
- `POST /api/tasks/<id>/claim` claims it.
- `POST /api/tasks/<id>/done` marks it done.
- `DELETE /api/tasks/<id>` deletes it when your token has access.

Omit `roomId` to file in your current room. Use `roomId:""` for office-wide globals.
