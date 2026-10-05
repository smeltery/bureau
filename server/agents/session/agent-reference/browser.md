# Experimental Browser Control

When `experimental.browserPanel` is enabled, use `POST /api/agents/<your-id>/browser`.

Actions include:

- `goto` with `url`
- `snapshot`
- `text`
- `click`
- `fill`
- `press`
- `screenshot`
- `close`

The URL policy matches preview capture: local/private or explicitly allowed origins only. Downloads and URL credentials are refused.
