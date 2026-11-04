import { DocsSearch } from './search/DocsSearch.tsx';
import { DocActions } from './actions/DocActions.tsx';
import { BrandIcon } from './BrandIcon.tsx';
import { DocArticle } from './DocArticle.tsx';
import { findPage } from './pages.ts';
import { MobileNavigation } from './MobileNavigation.tsx';
import { DocsNavigation } from './DocsNavigation.tsx';
import { SITE } from '../site.ts';
import { CodeBlock } from './CodeBlock.tsx';
import { endpoints, setupExample } from './examples.ts';
import { Guides } from './Guides.tsx';
import './docs.css';
import './docs-content.css';
import './docs-mobile.css';
import './actions/doc-actions.css';

export function ApiDocs() {
  const page = findPage(window.location.pathname);
  const toc = page
    ? page.sections.map((section) => ({
        href: `#${section.id}`,
        title: section.title,
      }))
    : [
        { href: '#overview', title: 'Overview' },
        { href: '#quickstart', title: 'Quickstart' },
        { href: '#send-message', title: 'Messages' },
        { href: '#create-task', title: 'Tasks' },
        { href: '#client', title: 'Scripting' },
      ];
  return (
    <div className="docs-page">
      <header className="docs-header">
        <a className="skip-link" href="#docs-main">
          Skip to content
        </a>
        <MobileNavigation />
        <a className="brand" href="/">
          <img className="brand-mark" src="/logo.svg" width="25" height="25" alt="" />
          bureau<span className="brand-dot">.</span>
        </a>
        <span className="docs-header-label">Documentation</span>
        <nav aria-label="Documentation">
          <a href="/docs/api/">API reference</a>
          <a href="/docs/examples/">Examples</a>
          <a className="brand-heading" href={SITE.github}>
            <BrandIcon name="GitHub" size={16} />
            GitHub ↗
          </a>
        </nav>
        <DocsSearch />
      </header>
      <div className="docs-layout">
        <aside className="docs-sidebar">
          <DocsNavigation />
        </aside>
        <main className="docs-main" id="docs-main">
          <details className="mobile-toc">
            <summary>On this page</summary>
            <nav aria-label="On this page">
              {toc.map((item) => (
                <a key={item.href} href={item.href}>
                  {item.title}
                </a>
              ))}
            </nav>
          </details>
          {page ? (
            <DocArticle page={page} />
          ) : (
            <>
              <section id="overview">
                <p className="eyebrow">DEVELOPER DOCUMENTATION</p>
                <h1>
                  Your agents.
                  <br />
                  <em>On call.</em>
                </h1>
                <p className="docs-lead">The Bureau API lets scripts, CI jobs, and other tools work with your office: hand an agent a task, read its reply, and keep the task board current.</p>
                <div className="docs-notice">Self-hosted. Requests go to your own office, authenticated with a personal API token that acts as you.</div>
                <div className="docs-base">
                  <span>Office API · local default</span>
                  <code>http://localhost:4000</code>
                </div>
                <p className="docs-flow">
                  <a href="#list-agents">Find an agent</a>, <a href="#send-message">send it a message</a>, then <a href="#drain-inbox">read its reply</a> when it is done.
                </p>
              </section>
              <section id="quickstart">
                <h2>Your first message</h2>
                <p>Start the office, claim it from the server machine, and create a personal API token in User Settings → API tokens. The token is shown once; keep it in your secret manager.</p>
                <CodeBlock label="Terminal · local office" code={setupExample} />
                <p>
                  Then list agents with the example below. Set <code>AGENT_ID</code> to an agent’s <code>id</code> before sending a message.
                </p>
              </section>
              <section id="authentication">
                <h2>Authentication</h2>
                <p>
                  Every <code>/api</code> endpoint requires <code>Authorization: Bearer &lt;token&gt;</code>. Tokens start with <code>bureau_pat_</code>, expire after 30 days, a year, or never, and
                  carry the same room access as the person who created them.
                </p>
                <div className="docs-notice">
                  Use tokens in trusted code only. Do not embed them in a public website or client bundle. <code>GET /readyz</code> is the only unauthenticated API route.
                </div>
              </section>
              {endpoints.map((endpoint) => (
                <section className="endpoint-section" id={endpoint.id} key={endpoint.id}>
                  <div className="endpoint-title">
                    <span className={`method method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
                    <h2>{endpoint.title}</h2>
                  </div>
                  <code className="endpoint-path">{endpoint.path}</code>
                  <p>{endpoint.description}</p>
                  <CodeBlock label="cURL" code={endpoint.example} />
                  {endpoint.id === 'send-message' && <CodeBlock label="Example response" code={'{\n  "messageId": "4b1f0c2e-8f7a-4d0e-9c1b-2a6f3e5d7c90"\n}'} />}
                </section>
              ))}
              <Guides />
            </>
          )}
          <div className="mobile-doc-actions">
            <DocActions page={page} />
          </div>
          <footer className="docs-footer">
            <a href="/">← bureau home</a>
            <a href={`${SITE.github}/tree/master/website/src/docs`}>View documentation source ↗</a>
          </footer>
        </main>
        <aside className="docs-toc">
          <p>ON THIS PAGE</p>
          {toc.map((item) => (
            <a key={item.href} href={item.href}>
              {item.title}
            </a>
          ))}
          <DocActions page={page} />
        </aside>
      </div>
    </div>
  );
}
