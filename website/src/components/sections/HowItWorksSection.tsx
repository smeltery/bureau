'use client';

import { Download, Monitor, Workflow } from 'lucide-react';

export function HowItWorksSection() {
  const steps = [
    {
      icon: <Download className="h-8 w-8" />,
      step: '1',
      title: 'Install and Authenticate',
      description:
        'Install Bureau with Bun, then authenticate Claude Code once. Bureau reuses your local CLI identity.',
    },
    {
      icon: <Monitor className="h-8 w-8" />,
      step: '2',
      title: 'Open Your Office',
      description:
        'Launch the app and click an empty desk to spawn a new agent session with its own terminal and conversation.',
    },
    {
      icon: <Workflow className="h-8 w-8" />,
      step: '3',
      title: 'Coordinate in Real Time',
      description:
        'Track progress, assign tasks, and jump between agents from desktop or mobile while everything stays synced.',
    },
  ];

  return (
    <section id="how-it-works" className="bg-dark-gray/50 py-12 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-10 text-center sm:mb-16">
          <h2 className="mb-3 text-3xl font-bold text-cream sm:mb-4 sm:text-4xl lg:text-5xl">
            How It Works
          </h2>
          <p className="mx-auto max-w-3xl text-base text-cream/70 sm:text-lg lg:text-xl">
            Three steps from install to a fully operational agent office
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 sm:gap-8 lg:grid-cols-3">
          {steps.map((step, index) => (
            <div
              key={index}
              className="relative sm:col-span-2 last:sm:col-start-auto lg:col-span-1 lg:last:col-start-auto"
            >
              <div className="h-full rounded-xl border border-distill-purple/30 bg-dark-slate p-6 text-center transition-all hover:border-distill-lavender/40 sm:p-8">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-distill-purple to-distill-violet text-xl font-bold text-white sm:mb-4 sm:h-16 sm:w-16 sm:text-2xl">
                  {step.step}
                </div>
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center text-distill-purple sm:mb-4 sm:h-12 sm:w-12">
                  {step.icon}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-cream sm:mb-3 sm:text-xl">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-cream/60 sm:text-base">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
