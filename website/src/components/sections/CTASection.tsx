'use client';

import { Github, BookOpen, MessageCircle } from 'lucide-react';

export function CTASection() {
  return (
    <section className="bg-gradient-to-br from-distill-purple/10 via-dark-slate to-dark-slate py-12 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
        <h2 className="mb-4 text-3xl font-bold text-cream sm:mb-6 sm:text-4xl lg:text-5xl">
          Ready to Run Your Agent Office?
        </h2>
        <p className="mx-auto mb-8 max-w-3xl text-base text-cream/70 sm:mb-12 sm:text-lg lg:text-xl">
          Start Bureau locally, expand to an always-on server when needed, and keep your multi-agent workflow in one place
        </p>
        <div className="grid gap-4 sm:grid-cols-3 sm:gap-6">
          <a
            href="https://github.com/smeltery/bureau"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-distill-purple/30 bg-dark-gray/50 p-6 transition-all hover:border-distill-purple hover:shadow-lg hover:shadow-distill-purple/20 sm:p-8"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-distill-purple to-distill-violet transition-transform group-hover:scale-110 sm:mb-4 sm:h-14 sm:w-14">
              <Github className="h-6 w-6 text-white sm:h-7 sm:w-7" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-cream sm:text-xl">View on GitHub</h3>
            <p className="text-xs text-cream/60 sm:text-sm">Star the repo and track releases</p>
          </a>
          <a
            href="https://github.com/smeltery/bureau#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-distill-violet/30 bg-dark-gray/50 p-6 transition-all hover:border-distill-violet hover:shadow-lg hover:shadow-distill-violet/20 sm:p-8"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-distill-violet to-distill-lavender transition-transform group-hover:scale-110 sm:mb-4 sm:h-14 sm:w-14">
              <BookOpen className="h-6 w-6 text-white sm:h-7 sm:w-7" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-cream sm:text-xl">Read the Docs</h3>
            <p className="text-xs text-cream/60 sm:text-sm">Quick start, architecture, and guides</p>
          </a>
          <a
            href="https://github.com/smeltery/bureau/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-distill-lavender/30 bg-dark-gray/50 p-6 transition-all hover:border-distill-lavender hover:shadow-lg hover:shadow-distill-lavender/20 sm:p-8"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-distill-lavender to-distill-purple transition-transform group-hover:scale-110 sm:mb-4 sm:h-14 sm:w-14">
              <MessageCircle className="h-6 w-6 text-white sm:h-7 sm:w-7" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-cream sm:text-xl">Join Discussion</h3>
            <p className="text-xs text-cream/60 sm:text-sm">Share ideas and ask workflow questions</p>
          </a>
        </div>
      </div>
    </section>
  );
}
