import { SITE } from '../site.ts';

export function Workspace() {
  return (
    <section className="section workspace-section" id="workspace" aria-labelledby="workspace-title">
      <div className="workspace-copy">
        <p className="eyebrow">Stay close to the work</p>
        <h2 id="workspace-title">
          The answer is a start. <em>See the changes, too.</em>
        </h2>
        <p>
          Keep the conversation connected to the files, commands, and browser views you use to check
          the result.
        </p>
        <ul className="review-points">
          <li>
            <strong>Inspect the diff.</strong> Review additions and removals in a styled diff card.
          </li>
          <li>
            <strong>Try it yourself.</strong> Open the embedded terminal or file editor beside the
            chat.
          </li>
          <li>
            <strong>Give the next direction.</strong> Queue feedback while an agent works, or
            interrupt when the plan changes.
          </li>
        </ul>
        <a className="text-link" href={SITE.docs}>
          Explore the workspace tools <span aria-hidden="true">→</span>
        </a>
      </div>
      <figure className="review-example">
        <figcaption>
          <span className="example-label">Illustrated workflow</span>
          <span>Review a small change</span>
        </figcaption>
        <div className="example-message">
          <span className="example-avatar" aria-hidden="true">
            A
          </span>
          <div>
            <strong>Agent</strong>
            <p>The empty state now explains what to do next.</p>
          </div>
        </div>
        <div className="example-diff">
          <div className="diff-heading">
            <span>EmptyState.tsx</span>
            <span>1 removed · 1 added</span>
          </div>
          <pre aria-label="Example diff: replace No tasks with Create your first task.">
            <code>
              <span className="diff-removed">− No tasks</span>
              {'\n'}
              <span className="diff-added">+ Create your first task</span>
            </code>
          </pre>
        </div>
        <div className="example-feedback">
          <span className="example-label">Your next direction</span>
          <p>“Looks clearer. Make sure the button works on mobile, too.”</p>
        </div>
      </figure>
    </section>
  );
}
