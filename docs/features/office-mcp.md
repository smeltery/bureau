# Reach your agents over MCP

Connect an external MCP client to Bureau to ask your office agents for help and
read their replies. The office exposes a Streamable HTTP endpoint at `/mcp`.

## Connect

1. Create a personal API token in your member settings. Give each client its own
   token so its reply cursor and revocation are independent.
2. Configure the client's HTTP MCP server URL as `https://your-office.example/mcp`.
3. Set its `Authorization` header to `Bearer <your-personal-api-token>` using the
   client's secret settings. Keep the token out of committed project files.

The client must support custom bearer headers with Streamable HTTP. Bureau does
not offer an OAuth sign-in flow for this endpoint. Browser cookies, agent tokens,
and an unauthenticated localhost connection do not grant access.

The client must be able to reach your office URL. A client running on your own
computer can use its existing local or VPN access. A remotely hosted client needs
an office address reachable from that service. The office's external-access
setting still applies. See [access and invites](access-and-invites.md).

## Tools

- `list_agents` returns live agents in rooms your member can see, with IDs and
  activity. Use these IDs for subsequent calls.
- `read_conversation` takes `agentId`, optional `sessionId`, optional `limit`
  (1–200, default 50), and optional `before` (a timestamp in milliseconds). Without
  a session ID, it reads the current conversation. It returns human messages and
  agent text, plus current activity and pending-prompt status.
- `send_message` takes `agentId` and `text` (up to 100,000 characters). The agent
  sees your member name and token identity. Messages queue while the agent is
  busy. The returned `messageId` acknowledges acceptance, not task completion.
- `read_replies` takes `after` (a sequence cursor, initially 0) and optional
  `waitSeconds` (0–25). It reads this token's durable sends and addressed replies.
  It does not consume or delete them. Save the **last returned entry's sequence**
  for the next call, rather than `latestSequence`: a page may contain only part of
  the log. An empty page means no newer entries arrived during that wait.

Ask an agent to reply to this token when you need a response in `read_replies`;
ordinary conversation output is available through `read_conversation`. Token
logs remain subject to the office's manual retention controls. If `firstSequence`
passes your saved cursor, older entries may have been pruned.

## Permission and delivery boundaries

Every operation checks the current token and member. Listing and conversation
access follow room visibility. Sends check room access again at delivery time,
including changes made while the request waits for token persistence. Revoking a
token or removing its member stops subsequent operations and waiting reply polls.

Messages beginning with `/` are refused with `command_not_allowed`. An agent
waiting for a permission, resume, model, effort, or schedule choice returns
`awaits_member_answer`. Make those decisions inside Bureau, then send your next
message. MCP does not expose terminal control or office administration.

Sends are not idempotent. After a connection failure, inspect the token log before
retrying: the first message may already have been accepted. Retrying blindly can
deliver the same message twice.

## Transport

Use POST requests with `Content-Type: application/json` and
`Accept: application/json, text/event-stream`. The standard MCP initialization
exchange and protocol-version header are handled by the MCP SDK. Responses use
JSON; the endpoint has no persistent transport session or server-initiated SSE
stream. GET and DELETE return 405. Each request authenticates independently.

An Origin header, when present, must match the office or request origin. This
endpoint does not enable cross-origin browser clients. Tool failures return MCP
`isError` results; missing or invalid credentials return HTTP 401.
