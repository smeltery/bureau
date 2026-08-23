'use client';

import React from 'react';
import { Github, Terminal } from 'lucide-react';
import Link from 'next/link';

interface HeroSectionProps {
  onLearnMore?: () => void;
}

export function HeroSection({ onLearnMore }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-distill-purple/10 via-dark-slate to-dark-slate">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-distill-violet/20 via-transparent to-transparent"></div>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-24 sm:px-6 sm:pb-24 sm:pt-32 lg:pb-32 lg:pt-40">
        <div className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-distill-purple/20 bg-distill-purple/10 px-3 py-1.5 sm:mb-6">
            <Github className="h-3.5 w-3.5 text-distill-purple sm:h-4 sm:w-4" />
            <span className="text-xs font-medium text-distill-purple sm:text-sm">
              Open Source • PolyForm Shield 1.0.0
            </span>
          </div>

          <h1 className="mb-4 px-4 text-3xl font-extrabold leading-tight text-cream sm:mb-6 sm:text-5xl md:text-6xl lg:text-7xl">
            Go from One Claude Code to{' '}
            <span className="text-gradient drop-shadow-md">a Full Agent Office</span>
          </h1>
          <p className="mx-auto mb-6 max-w-4xl px-4 text-base leading-relaxed text-cream/70 sm:mb-8 sm:text-lg md:text-xl lg:text-2xl">
            Bureau is your browser-based command center for multiple agents. Spawn
            desks, monitor progress in real time, and collaborate from desktop or
            mobile without cloud lock-in.
          </p>
          <div className="flex flex-col justify-center gap-3 px-4 sm:flex-row sm:gap-4">
            <Link
              href="/#quick-start"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-distill-purple to-distill-violet px-6 py-3 text-base font-semibold text-white shadow-lg shadow-distill-purple/30 transition-all hover:from-distill-violet hover:to-distill-lavender sm:px-8 sm:py-4 sm:text-lg"
            >
              <Terminal className="h-4 w-4 sm:h-5 sm:w-5" />
              Get Started
            </Link>
            <a
              href="https://github.com/smeltery/bureau"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-distill-purple bg-dark-gray px-6 py-3 text-base font-semibold text-cream transition-all hover:border-distill-lavender hover:bg-dark-slate sm:px-8 sm:py-4 sm:text-lg"
            >
              <Github className="h-4 w-4 sm:h-5 sm:w-5" />
              View on GitHub
            </a>
          </div>
          <div className="mt-4">
            <button
              onClick={onLearnMore}
              className="text-sm text-cream/70 underline-offset-4 transition-colors hover:text-cream hover:underline"
            >
              Learn how it works
            </button>
          </div>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-4 px-4 sm:mt-16 sm:grid-cols-3 sm:gap-6 md:mt-24 md:gap-8">
          <div className="rounded-xl border border-distill-purple/30 bg-dark-gray/50 p-4 text-center backdrop-blur-sm sm:p-6">
            <div className="mb-2 text-3xl font-bold text-gradient sm:text-4xl md:text-5xl">8</div>
            <div className="text-sm text-cream/60 sm:text-base md:text-lg">Desk Capacity</div>
          </div>
          <div className="rounded-xl border border-distill-violet/30 bg-dark-gray/50 p-4 text-center backdrop-blur-sm sm:p-6">
            <div className="mb-2 text-3xl font-bold text-gradient sm:text-4xl md:text-5xl">Live</div>
            <div className="text-sm text-cream/60 sm:text-base md:text-lg">WebSocket Sync</div>
          </div>
          <div className="rounded-xl border border-distill-lavender/30 bg-dark-gray/50 p-4 text-center backdrop-blur-sm sm:p-6">
            <div className="mb-2 text-3xl font-bold text-gradient sm:text-4xl md:text-5xl">Local</div>
            <div className="text-sm text-cream/60 sm:text-base md:text-lg">No Cloud Account</div>
          </div>
        </div>
      </div>
    </section>
  );
}
