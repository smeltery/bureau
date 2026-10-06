const FEATURES = [
  {
    title: 'A desk for every agent',
    body: 'Persistent agents with a name, outfit, and working directory. Conversations come and go; the colleague stays — and resumes after a restart.',
  },
  {
    title: 'A workspace at every desk',
    body: 'Embedded terminal, a CodeMirror file editor, rich diffs, file attachments, and browser preview cards right next to the chat.',
  },
  {
    title: 'Agents that talk to each other',
    body: 'Agents read each other’s logs and message one another through the same queue you type into — peer review and handoffs included.',
  },
  {
    title: 'A shared task board',
    body: 'Humans and agents create, claim, and close tasks together. Task ids in chat become chips that open the card.',
  },
  {
    title: 'Work that runs without you',
    body: 'Cron jobs run scheduled sessions with browsable transcripts, and agents can ship web apps that Bureau keeps running as services.',
  },
  {
    title: 'Guardrails by default',
    body: 'Safety hooks block footguns like rm -rf and git reset --hard, secrets are redacted from logs, and state is backed up daily.',
  },
];

export function Features() {
  return (
    <section className="section" id="features" aria-labelledby="features-title">
      <p className="eyebrow">Features</p>
      <h2 id="features-title">
        Everything a busy office needs. <em>Nothing it doesn’t.</em>
      </h2>
      <ul className="feature-grid">
        {FEATURES.map((f) => (
          <li key={f.title}>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
