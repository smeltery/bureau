'use client';

import React, { useState } from 'react';
import { CodeBlock } from '@/components/CodeBlock';

export function CodeExamplesSection() {
  const [activeTab, setActiveTab] = useState<
    'local' | 'commands' | 'server' | 'workflow'
  >('local');

  const examples = {
    local: `# Clone and run Bureau locally
git clone https://github.com/smeltery/bureau.git
cd bureau
bun install
bun run dev

# Open the office
open http://localhost:4000`,
    commands: `# Built-in slash commands
/help
/bureau-all-hands
/bureau-peer-review

# Typical prompt inside a desk
Implement the login flow in src/auth.ts
and write tests for edge cases.`,
    server: `# Run Bureau on an always-on machine
bun run dev

# Expose securely with Tailscale
tailscale up
tailscale serve --bg http://localhost:4000

# Access from laptop or phone
http://my-mac-mini:4000`,
    workflow: `# Parallelize work across desks
# Desk A: implement feature
# Desk B: write tests
# Desk C: review and summarize risks

# Use the shared board to coordinate
# and monitor each desk in real time.`,
  };

  const tabs = [
    { key: 'local' as const, label: 'Local Run', language: 'bash' },
    { key: 'commands' as const, label: 'Commands', language: 'bash' },
    { key: 'server' as const, label: 'Self-Hosted', language: 'bash' },
    { key: 'workflow' as const, label: 'Workflow', language: 'bash' },
  ];

  return (
    <section id="code-examples" className="bg-dark-gray/50 py-12 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-10 text-center sm:mb-16">
          <h2 className="mb-3 text-3xl font-bold text-cream sm:mb-4 sm:text-4xl lg:text-5xl">
            Workflow Examples
          </h2>
          <p className="mx-auto max-w-3xl text-base text-cream/70 sm:text-lg lg:text-xl">
            Local startup, slash commands, self-hosting, and multi-desk collaboration patterns
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-distill-purple/30 bg-dark-slate">
          <div className="flex overflow-x-auto border-b border-distill-purple/30">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 whitespace-nowrap px-3 py-3 text-xs font-semibold transition-colors sm:px-6 sm:py-4 sm:text-sm ${
                  activeTab === tab.key
                    ? 'border-b-2 border-distill-purple bg-dark-gray/50 text-distill-purple'
                    : 'text-cream/70 hover:bg-dark-gray/30 hover:text-cream'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto p-4 sm:p-6">
            <CodeBlock
              code={examples[activeTab]}
              language={tabs.find((t) => t.key === activeTab)?.language}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
