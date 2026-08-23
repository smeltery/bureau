'use client';

import React, { useState } from 'react';
import { CodeBlock } from '@/components/CodeBlock';

export function QuickStartSection() {
  const [installMethod, setInstallMethod] = useState<'bun' | 'claude' | 'clone'>('bun');

  const installExamples = {
    bun: `# Install Bun
curl -fsSL https://bun.sh/install | bash`,
    claude: `# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Authenticate once
claude`,
    clone: `git clone https://github.com/smeltery/bureau.git
cd bureau`,
  };

  return (
    <section id="quick-start" className="overflow-hidden bg-dark-slate py-12 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-10 text-center sm:mb-16">
          <h2 className="mb-3 text-3xl font-bold text-cream sm:mb-4 sm:text-4xl lg:text-5xl">
            Quick Start
          </h2>
          <p className="mx-auto max-w-3xl text-base text-slate-gray sm:text-lg lg:text-xl">
            Install prerequisites, launch Bureau, and open your first desk in under a minute
          </p>
        </div>
        <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="min-w-0 rounded-xl border border-distill-purple/20 bg-dark-gray/50 p-6 sm:p-8">
            <h3 className="mb-4 text-xl font-bold text-cream sm:mb-6 sm:text-2xl">1. Prepare Environment</h3>
            <div className="mb-6 flex gap-2 sm:gap-3">
              {[
                { key: 'bun' as const, label: 'Bun' },
                { key: 'claude' as const, label: 'Claude CLI' },
                { key: 'clone' as const, label: 'Clone Repo' },
              ].map((method) => (
                <button
                  key={method.key}
                  onClick={() => setInstallMethod(method.key)}
                  className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all sm:px-4 ${
                    installMethod === method.key
                      ? 'bg-gradient-to-r from-distill-purple to-distill-violet text-white shadow-lg shadow-distill-purple/30'
                      : 'border border-distill-purple/30 bg-dark-slate text-slate-gray hover:border-distill-purple/50 hover:text-cream'
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>
            <CodeBlock code={installExamples[installMethod]} language="bash" />
          </div>
          <div className="min-w-0 rounded-xl border border-distill-violet/20 bg-dark-gray/50 p-6 sm:p-8">
            <h3 className="mb-4 text-xl font-bold text-cream sm:mb-6 sm:text-2xl">2. Launch Office</h3>
            <CodeBlock
              code={`bun install
bun run dev

# Open Bureau in your browser
open http://localhost:4000

# Click an empty desk to spawn your first agent`}
              language="bash"
            />
            <div className="mt-6 rounded-lg border border-distill-purple/30 bg-distill-purple/10 p-4 sm:p-5">
              <p className="text-sm leading-relaxed text-cream">
                <span className="font-semibold text-distill-purple">Tip:</span> Bureau is
                local-first and works with your existing Claude Code login — no extra cloud account required.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
