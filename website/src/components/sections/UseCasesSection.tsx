'use client';

import { Rocket, Smartphone, Server, Users, Clock3, ShieldCheck } from 'lucide-react';

export function UseCasesSection() {
  const useCases = [
    {
      icon: <Rocket className="h-6 w-6" />,
      title: 'Solo Founder Command Center',
      description:
        'Run feature implementation, testing, and review in parallel without leaving one browser workspace.',
    },
    {
      icon: <Smartphone className="h-6 w-6" />,
      title: 'Mobile Oversight',
      description:
        'Check agent progress and unblock work from your phone while you are away from your main machine.',
    },
    {
      icon: <Server className="h-6 w-6" />,
      title: 'Always-On Home Server',
      description:
        'Host Bureau on a Mac Mini or Linux box and access the same office from every device over Tailscale.',
    },
    {
      icon: <Users className="h-6 w-6" />,
      title: 'Pairing with Specialist Agents',
      description:
        'Assign focused desks for frontend, backend, and testing while retaining shared context through logs and tasks.',
    },
    {
      icon: <Clock3 className="h-6 w-6" />,
      title: 'Long-Running Workflows',
      description:
        'Keep agents running overnight and return to persistent sessions, status indicators, and conversation history.',
    },
    {
      icon: <ShieldCheck className="h-6 w-6" />,
      title: 'Safety-Conscious Automation',
      description:
        'Use built-in command guardrails to reduce risky tool execution while still moving quickly with agents.',
    },
  ];

  return (
    <section id="use-cases" className="bg-dark-slate py-12 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-10 text-center sm:mb-16">
          <h2 className="mb-3 text-3xl font-bold text-cream sm:mb-4 sm:text-4xl lg:text-5xl">
            Use Cases
          </h2>
          <p className="mx-auto max-w-3xl text-base text-cream/70 sm:text-lg lg:text-xl">
            Bureau adapts to solo builders, small teams, and always-on agent infrastructure
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 lg:gap-8">
          {useCases.map((useCase, index) => (
            <div
              key={index}
              className="rounded-xl border border-distill-purple/20 bg-dark-gray/50 p-5 transition-all hover:border-distill-lavender/40 sm:p-6"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-distill-purple to-distill-violet text-white sm:mb-4 sm:h-12 sm:w-12">
                {useCase.icon}
              </div>
              <h3 className="mb-2 text-lg font-semibold text-cream sm:text-xl">{useCase.title}</h3>
              <p className="text-sm leading-relaxed text-cream/60 sm:text-base">
                {useCase.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
