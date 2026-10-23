# Continue after a provider usage reset

Claude and Codex agents can continue the same conversation after a subscription
usage limit stops their turn. **Resume after usage limit** is enabled by default;
turn it off in the agent's settings to require a manual continuation.

Bureau schedules one continuation for one minute after the provider's reported
reset. The conversation receives a system notice with the scheduled time, and
agent settings show the pending time in your local timezone. A notice below the
conversation includes a Stop button throughout the wait. This uses structured
provider data, not dates guessed from an error message.

- Claude must report both a main-conversation quota refusal and a rejected quota
  window with a reset time.
- Codex must report `usageLimitExceeded`. Bureau uses the blocking allowance
  windows, refreshing stale or missing data for up to two seconds. Spend controls,
  exhausted credits, authentication failures, and ordinary rate limits do not
  schedule a continuation.
- OpenCode does not support this option. Short provider-capacity retries are a
  separate mechanism.

Messages queued while waiting stay queued until the continuation, when they
join the same turn. An explicit new human turn cancels the wait.

The scheduled time and conversation identity survive a server restart. If the
reset occurred while Bureau was down, it waits at least 30 seconds after restoring
the agent before trying to continue. It never uses a schedule for a different
conversation. The member's normal usage cap and provider sign-in checks still
apply to the continuation.

**Stop cancels a pending continuation**, even when the agent is otherwise idle.
Starting new work, replacing or clearing the conversation, killing the agent,
or disabling the option also cancels it. Turning the option back on does not
reinstate a canceled schedule; a later quota stop can schedule a new one.

At the scheduled time, Bureau clears the schedule before attempting one send.
It does not send if the agent is busy, is waiting for a member's permission or
choice, is changing conversations, or has entered another error
or sign-in state. There is no repeated retry loop: a stale reset time cannot
schedule another continuation. A later, newly reported quota window can.
