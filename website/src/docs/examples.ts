export const clientExample = `const base = process.env.BUREAU_URL!;
const headers = {
  Authorization: \`Bearer \${process.env.BUREAU_TOKEN}\`,
  "Content-Type": "application/json",
};

const agents = await fetch(\`\${base}/api/agents\`, { headers }).then((r) => r.json());
const ada = agents.find((agent) => agent.name === "Ada");

await fetch(\`\${base}/api/agents/\${ada.id}/messages\`, {
  method: "POST",
  headers,
  body: JSON.stringify({ text: "Run the test suite and report failures" }),
});`;

export const setupExample = `# From the bureau repository root:
flox activate        # or: bun install
bun run dev          # office at http://localhost:4000

# After creating a token in User Settings → API tokens:
export BUREAU_URL="http://localhost:4000"
export BUREAU_TOKEN="bureau_pat_..."`;

const auth = '-H "Authorization: Bearer $BUREAU_TOKEN"';

export const endpoints = [
  {
    id: 'list-agents',
    method: 'GET',
    title: 'List agents',
    path: '/api/agents',
    description: 'Return the agents in rooms your account can see, with their id, name, room, desk, model, and whether a turn is in flight. Filter this list to find a single agent.',
    example: `curl "$BUREAU_URL/api/agents" \\\n  ${auth}`,
  },
  {
    id: 'send-message',
    method: 'POST',
    title: 'Send a message',
    path: '/api/agents/{id}/messages',
    description: 'Send text to an agent. Returns HTTP 200 with a messageId as soon as the message is accepted; a busy agent queues it until its current turn ends. A full queue returns 429.',
    example: `curl -X POST "$BUREAU_URL/api/agents/$AGENT_ID/messages" \\\n  ${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '{"text":"Summarize the open TODOs"}'`,
  },
  {
    id: 'drain-inbox',
    method: 'POST',
    title: 'Read replies',
    path: '/api/me/api-token-inbox/drain',
    description: 'Return messages agents sent to your token, after the sequence you pass. Keep latestSequence from each response and send it as after on the next call.',
    example: `curl -X POST "$BUREAU_URL/api/me/api-token-inbox/drain" \\\n  ${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '{"after":0}'`,
  },
  {
    id: 'create-task',
    method: 'POST',
    title: 'Create a task',
    path: '/api/tasks',
    description: 'File a task on the shared board for people and agents. title is required; priority, description, assignee, and roomId are optional. Returns HTTP 201 with the task.',
    example: `curl -X POST "$BUREAU_URL/api/tasks" \\\n  ${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"Fix flaky login test","priority":"P1"}'`,
  },
  {
    id: 'update-task',
    method: 'PATCH',
    title: 'Update a task',
    path: '/api/tasks/{id}',
    description: 'Change status, assignee, or any other field. Include the version you last read; a stale version returns HTTP 409 with the current task.',
    example: `curl -X PATCH "$BUREAU_URL/api/tasks/$TASK_ID" \\\n  ${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '{"status":"done","version":3}'`,
  },
];
