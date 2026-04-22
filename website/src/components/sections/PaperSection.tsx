'use client';

import { ExternalLink, BookOpen, Cpu, Network, HardDrive, GitBranch } from 'lucide-react';

const contributions = [
  {
    icon: <GitBranch className="h-5 w-5" />,
    title: 'Agent / Conversation Separation',
    description:
      'Agents are persistent desk identities while conversations are task-specific sessions, which keeps workflow flexible and resumable.',
  },
  {
    icon: <Cpu className="h-5 w-5" />,
    title: 'Single-Process Runtime',
    description:
      'Bureau runs as one Bun process that serves UI, manages sessions with the Claude Agent SDK, and coordinates orchestration logic.',
  },
  {
    icon: <Network className="h-5 w-5" />,
    title: 'WebSocket Synchronization Layer',
    description:
      'State updates are pushed live to all connected devices so mobile and desktop views stay consistent.',
  },
  {
    icon: <HardDrive className="h-5 w-5" />,
    title: 'File-System Persistence',
    description:
      'Agents and logs are persisted in local files under ~/.bureau so sessions survive restarts and crashes.',
  },
];

export function PaperSection() {
  return (
    <section id="architecture" className="bg-dark-gray/50 py-12 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-10 text-center sm:mb-16">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-distill-purple/30 bg-distill-purple/10 px-3 py-1 text-xs font-medium text-distill-purple">
            Design Deep Dive
          </div>
          <h2 className="mb-3 text-3xl font-bold text-cream sm:mb-4 sm:text-4xl lg:text-5xl">
            The Architecture Behind Bureau
          </h2>
          <p className="mx-auto max-w-3xl text-base text-cream/70 sm:text-lg lg:text-xl">
            Read the design article covering session lifecycle, runtime decisions, and synchronization model
          </p>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="rounded-2xl border border-distill-purple/20 bg-dark-slate p-8 sm:p-10">
            <div className="mb-6 flex items-start gap-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-distill-purple to-distill-violet text-white">
                <BookOpen className="h-6 w-6" />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-distill-purple">
                  Design Document
                </p>
                <h3 className="text-lg font-bold leading-snug text-cream sm:text-xl">
                  Bureau: Design and Architecture
                </h3>
              </div>
            </div>
            <p className="mb-5 text-xs text-cream/50">Nicholas Adamou — dotbrains</p>
            <p className="mb-8 text-sm leading-relaxed text-cream/70">
              This article explains how Bureau models agent identity, keeps sessions persistent,
              and synchronizes every connected client in real time without a traditional backend stack.
            </p>
            <a
              href="https://github.com/dotbrains/bureau/blob/master/articles/design-and-architecture.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-distill-purple to-distill-violet px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-distill-purple/30 transition-all hover:from-distill-violet hover:to-distill-lavender"
            >
              Read the Architecture Article
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          <div className="space-y-4">
            {contributions.map((c, i) => (
              <div
                key={i}
                className="group flex gap-4 rounded-xl border border-distill-purple/10 bg-dark-slate p-4 transition-all hover:border-distill-lavender/30 sm:p-5"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-distill-purple to-distill-violet text-white transition-transform group-hover:scale-110">
                  {c.icon}
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-medium text-distill-purple">({i + 1})</span>
                    <h4 className="text-sm font-semibold text-cream sm:text-base">{c.title}</h4>
                  </div>
                  <p className="text-xs leading-relaxed text-cream/60 sm:text-sm">{c.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
