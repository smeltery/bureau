'use client';

import {
  LayoutGrid,
  Users,
  RefreshCw,
  Smartphone,
  Terminal,
  Mic,
  Shield,
  GitBranch,
  ListChecks,
  Eye,
  Paperclip,
} from 'lucide-react';

export function FeaturesSection() {
  const features = [
    {
      icon: <LayoutGrid className="h-6 w-6" />,
      title: 'Visual Office Metaphor',
      description:
        'Each agent sits at a desk with live status cues so you can see who is typing, waiting, or idle at a glance.',
    },
    {
      icon: <Users className="h-6 w-6" />,
      title: 'Multi-Agent Orchestration',
      description:
        'Spawn and manage concurrent Claude Code sessions from one interface instead of juggling terminals.',
    },
    {
      icon: <RefreshCw className="h-6 w-6" />,
      title: 'Real-Time Sync',
      description:
        'WebSocket synchronization keeps every connected browser in lockstep across conversations and agent state.',
    },
    {
      icon: <Smartphone className="h-6 w-6" />,
      title: 'Mobile + PWA',
      description:
        'Continue monitoring and chatting with agents from your phone with touch-optimized controls.',
    },
    {
      icon: <Terminal className="h-6 w-6" />,
      title: 'Embedded Terminal',
      description:
        'Every desk can expose shell access so you can inspect or intervene without leaving Bureau.',
    },
    {
      icon: <Mic className="h-6 w-6" />,
      title: 'Voice Input & Output',
      description:
        'Use speech-to-text prompts and text-to-speech responses for faster interaction loops.',
    },
    {
      icon: <Shield className="h-6 w-6" />,
      title: 'Safety Hooks',
      description:
        'Pre-tool-call guardrails block dangerous commands like destructive filesystem or git operations.',
    },
    {
      icon: <GitBranch className="h-6 w-6" />,
      title: 'Conversation Branching',
      description:
        'Fork any point in a conversation and explore alternatives without losing the original thread.',
    },
    {
      icon: <ListChecks className="h-6 w-6" />,
      title: 'Shared Task Board',
      description:
        'Humans and agents can create, claim, and complete tasks through both UI and API workflows.',
    },
    {
      icon: <Eye className="h-6 w-6" />,
      title: 'Inter-Agent Discovery',
      description:
        "Agents can inspect each other's progress so work can be coordinated across desks.",
    },
    {
      icon: <Paperclip className="h-6 w-6" />,
      title: 'Rich Attachments',
      description:
        'Attach images, PDFs, and files directly to conversations so agents can reason over source material.',
    },
  ];

  return (
    <section id="features" className="bg-dark-slate py-12 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-10 text-center sm:mb-16">
          <h2 className="mb-3 text-3xl font-bold text-cream sm:mb-4 sm:text-4xl lg:text-5xl">
            Built for Real Agent Workflows
          </h2>
          <p className="mx-auto max-w-3xl text-base text-cream/70 sm:text-lg lg:text-xl">
            Bureau combines visibility, control, and collaboration so multi-agent development stays manageable
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 lg:gap-8">
          {features.map((feature, index) => (
            <div
              key={index}
              className="group rounded-xl border border-distill-purple/20 bg-dark-gray/50 p-5 transition-all hover:border-distill-lavender/40 hover:shadow-lg hover:shadow-distill-purple/10 sm:p-6"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-distill-purple to-distill-violet text-white transition-transform group-hover:scale-110 sm:mb-4 sm:h-12 sm:w-12">
                {feature.icon}
              </div>
              <h3 className="mb-2 text-lg font-semibold text-cream sm:text-xl">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-cream/60 sm:text-base">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
