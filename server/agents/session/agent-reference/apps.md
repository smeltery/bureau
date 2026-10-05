# Registered Apps

Register durable apps only when the boss wants something they will keep using.

- `POST /api/apps` with `name`, `command`, `cwd`, and optional `description` creates the app. Bureau allocates the port and passes it as `PORT`.
- `GET /api/apps` lists visible apps. `GET /api/apps/<name>` reads one.
- `PATCH /api/apps/<name>` changes `command`, `cwd`, or `description`.
- `POST /api/apps/<name>/start`, `/stop`, or `/restart` controls the service.
- `GET /api/apps/<name>/logs?lines=50` reads recent output.
- `DELETE /api/apps/<name>` stops and retires the app name.

Apps receive `BUREAU_APP_DATA_DIR` for persistent backed-up state and `BUREAU_APP_TOKEN` for server-side `POST /api/app/message` alerts back to your chat.
