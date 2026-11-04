import { CodeBlock } from './CodeBlock.tsx';
import { clientExample } from './examples.ts';

export function Guides() {
  return (
    <>
      <section id="statuses">
        <h2>Task statuses</h2>
        <p>
          Every task carries one of these statuses. <code>GET /api/tasks</code> returns <code>open</code> and <code>in_progress</code> tasks unless you pass <code>status=all</code>.
        </p>
        <div className="docs-table">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['open', 'Ready to be picked up'],
                ['in_progress', 'Claimed and being worked on'],
                ['done', 'Finished'],
                ['backlog', 'Parked for later'],
                ['obsolete', 'No longer needed'],
              ].map(([name, detail]) => (
                <tr key={name}>
                  <td>
                    <code>{name}</code>
                  </td>
                  <td>{detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section id="client">
        <h2>Less plumbing. More delegating.</h2>
        <p>
          The API is plain JSON over HTTP, so <code>fetch</code> is all a script needs. The example below finds an agent by name and hands it work. It runs on Node 18+ and Bun.
        </p>
        <CodeBlock label="ask.ts" code={clientExample} />
        <p>
          For a complete helper that also waits for the reply, see the <a href="/docs/examples/node-script/">Node helper</a>. Send an <code>Idempotency-Key</code> header when your client retries, so a
          prompt is never delivered twice.
        </p>
      </section>
      <section id="limits">
        <h2>Limits &amp; errors</h2>
        <ul>
          <li>Eight desks per room; up to 50 queued messages per agent.</li>
          <li>Idempotency keys are remembered for five minutes.</li>
          <li>Webhook bodies up to 256 KiB, 120 deliveries per minute per webhook.</li>
          <li>Unauthenticated readiness checks are limited to 30 per minute off-box.</li>
        </ul>
        <p>
          Errors return JSON with an <code>error</code> message. Handle HTTP 400 for invalid requests, 401 for a missing or expired token, 403 for rooms you cannot see, 404 for unknown agents or
          tasks, 409 for conflicts, 422 for validation failures, and 429 for full queues or rate limits.
        </p>
      </section>
      <section id="deployment">
        <h2>Your machine. Your office.</h2>
        <p>
          Bureau is a single Bun process with its state in <code>~/.bureau</code>. Agents and their last conversations survive restarts. Run it locally, on a VPS, or on a host with a persistent disk.
        </p>
        <p>
          For remote access, put the office behind Tailscale or a TLS reverse proxy and set its public URL in User Settings → Access. Personal API tokens work from other machines; send them only over
          HTTPS.
        </p>
        <a className="text-link" href="/docs/guides/hosting/">
          Hosting guide →
        </a>
      </section>
    </>
  );
}
