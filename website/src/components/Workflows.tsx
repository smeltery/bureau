import { SITE } from '../site.ts';

const WORKFLOWS = [
  {
    id: 'build',
    label: 'Build a feature',
    title: 'Give the work a desk.',
    description: 'Keep implementation, review, and the next decision in the same office.',
    prompt: 'Add a settings page. Ask another agent to review the changes before I take a look.',
    steps: [
      [
        'Define the task',
        'Put the goal on the shared task board so people and agents can follow it.',
      ],
      ['Bring in a second opinion', 'Ask another agent to inspect the work and send feedback.'],
      [
        'Review the changes',
        'Open the diff and terminal beside the conversation, then decide what ships.',
      ],
    ],
    result: 'A task, a conversation, and changes you can inspect.',
    link: SITE.tasks,
    linkLabel: 'Explore the task board',
  },
  {
    id: 'routine',
    label: 'Run a routine',
    title: 'Make the repeat work repeatable.',
    description: 'Save a prompt and schedule a fresh session to work through it.',
    prompt: 'Every weekday, inspect the open issues and summarize what needs my attention.',
    steps: [
      ['Write the brief', 'Choose the prompt, working directory, model, and schedule.'],
      ['Let the schedule start it', 'A new session runs the saved brief at the configured time.'],
      [
        'Read what happened',
        'Browse the run history and transcript before deciding on follow-up work.',
      ],
    ],
    result: 'A repeatable brief with a record of each run.',
    link: SITE.schedules,
    linkLabel: 'See how schedules work',
  },
  {
    id: 'app',
    label: 'Iterate on an app',
    title: 'Keep the builder beside the build.',
    description: 'Open an agent-built app and talk to its assigned agent in the same view.',
    prompt: 'Build a small release dashboard. Then help me refine it while I try it out.',
    steps: [
      ['Build in the office', 'Ask an agent to create and register a web app.'],
      [
        'Open the app view',
        'Use the app and its agent chat side by side on a configured app hostname.',
      ],
      [
        'Keep the feedback close',
        'Describe the next change without leaving the app you are reviewing.',
      ],
    ],
    result: 'An app you can use, with its builder one conversation away.',
    link: SITE.appChat,
    linkLabel: 'Explore app chat',
  },
];

export function Workflows() {
  return (
    <section className="section workflows" id="workflows" aria-labelledby="workflows-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Put it to work</p>
          <h2 id="workflows-title">
            A place for the work. <em>And the follow-through.</em>
          </h2>
        </div>
        <p>
          One office, different rhythms. Explore an example of how a task can move from a first
          prompt to something you can review.
        </p>
      </div>
      <fieldset className="workflow-picker">
        <legend>Choose a workflow</legend>
        {WORKFLOWS.map((flow, index) => (
          <label key={flow.id} htmlFor={`workflow-${flow.id}`}>
            <input
              type="radio"
              name="workflow"
              id={`workflow-${flow.id}`}
              defaultChecked={index === 0}
              aria-controls={`workflow-panel-${flow.id}`}
            />
            {flow.label}
          </label>
        ))}
      </fieldset>
      <div className="workflow-stage">
        {WORKFLOWS.map((flow) => (
          <div
            className={`workflow-panel workflow-${flow.id}`}
            id={`workflow-panel-${flow.id}`}
            key={flow.id}
          >
            <div className="workflow-brief">
              <span className="example-label">Example brief</span>
              <blockquote>“{flow.prompt}”</blockquote>
              <p>{flow.result}</p>
              <a href={flow.link}>
                {flow.linkLabel} <span aria-hidden="true">→</span>
              </a>
            </div>
            <div className="workflow-story">
              <h3>{flow.title}</h3>
              <p>{flow.description}</p>
              <ol>
                {flow.steps.map(([title, description], index) => (
                  <li key={title}>
                    <span className="flow-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div>
                      <h4>{title}</h4>
                      <p>{description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
