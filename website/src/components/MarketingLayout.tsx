'use client';

import React, { useState } from 'react';
import { Github, ExternalLink, Menu, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

interface MarketingNavProps {
  transparent?: boolean;
}

export function MarketingNav({ transparent = false }: MarketingNavProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSmoothScroll = (
    e: React.MouseEvent<HTMLAnchorElement>,
    targetId: string,
  ) => {
    e.preventDefault();
    document.querySelector(targetId)?.scrollIntoView({ behavior: 'smooth' });
    setMobileMenuOpen(false);
  };

  return (
    <nav
      className={`fixed left-0 right-0 top-0 z-50 w-full px-4 py-4 backdrop-blur-xl transition-colors sm:px-6 ${
        transparent
          ? 'bg-dark-slate/80'
          : 'border-b border-distill-purple/30 bg-dark-slate'
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 transition-opacity hover:opacity-80 sm:gap-3"
        >
          <Image
            src="/ui-icon.svg"
            alt="bureau"
            width={32}
            height={32}
            className="h-7 w-7 sm:h-8 sm:w-8"
          />
          <span className="text-lg font-bold text-cream sm:text-xl">bureau</span>
        </Link>

        <div className="hidden items-center gap-8 lg:flex">
          <Link
            href="/#features"
            onClick={(e) => handleSmoothScroll(e, '#features')}
            className="text-sm font-medium text-cream/80 transition-colors hover:text-cream"
          >
            Features
          </Link>
          <Link
            href="/#how-it-works"
            onClick={(e) => handleSmoothScroll(e, '#how-it-works')}
            className="text-sm font-medium text-cream/80 transition-colors hover:text-cream"
          >
            How It Works
          </Link>
          <Link
            href="/#use-cases"
            onClick={(e) => handleSmoothScroll(e, '#use-cases')}
            className="text-sm font-medium text-cream/80 transition-colors hover:text-cream"
          >
            Use Cases
          </Link>
          <Link
            href="/#architecture"
            onClick={(e) => handleSmoothScroll(e, '#architecture')}
            className="text-sm font-medium text-cream/80 transition-colors hover:text-cream"
          >
            Architecture
          </Link>
          <div className="ml-2 flex items-center gap-3">
            <a
              href="https://github.com/dotbrains/bureau"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-distill-purple bg-dark-gray px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-dark-slate"
            >
              <Github className="h-4 w-4" />
              <span>Star</span>
            </a>
            <Link
              href="/#quick-start"
              onClick={(e) => handleSmoothScroll(e, '#quick-start')}
              className="rounded-lg bg-gradient-to-r from-distill-purple to-distill-violet px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-distill-purple/30 transition-all hover:from-distill-violet hover:to-distill-lavender"
            >
              Get Started
            </Link>
          </div>
        </div>

        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 text-cream transition-colors hover:text-distill-purple lg:hidden"
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? (
            <X className="h-6 w-6" />
          ) : (
            <Menu className="h-6 w-6" />
          )}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="fixed left-0 right-0 top-[72px] z-40 border-b border-distill-purple/30 bg-dark-slate shadow-xl backdrop-blur-xl lg:hidden">
          <div className="space-y-4 px-4 py-6">
            <Link
              href="/#features"
              onClick={(e) => handleSmoothScroll(e, '#features')}
              className="block py-2 text-base font-medium text-cream/80 transition-colors hover:text-cream"
            >
              Features
            </Link>
            <Link
              href="/#how-it-works"
              onClick={(e) => handleSmoothScroll(e, '#how-it-works')}
              className="block py-2 text-base font-medium text-cream/80 transition-colors hover:text-cream"
            >
              How It Works
            </Link>
            <Link
              href="/#use-cases"
              onClick={(e) => handleSmoothScroll(e, '#use-cases')}
              className="block py-2 text-base font-medium text-cream/80 transition-colors hover:text-cream"
            >
              Use Cases
            </Link>
            <Link
              href="/#architecture"
              onClick={(e) => handleSmoothScroll(e, '#architecture')}
              className="block py-2 text-base font-medium text-cream/80 transition-colors hover:text-cream"
            >
              Architecture
            </Link>
            <div className="space-y-3 border-t border-distill-purple/20 pt-4">
              <a
                href="https://github.com/dotbrains/bureau"
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-distill-purple bg-dark-gray px-4 py-3 text-sm font-medium text-cream transition-colors hover:bg-dark-slate"
              >
                <Github className="h-4 w-4" />
                <span>Star on GitHub</span>
              </a>
              <Link
                href="/#quick-start"
                onClick={(e) => handleSmoothScroll(e, '#quick-start')}
                className="flex w-full items-center justify-center rounded-lg bg-gradient-to-r from-distill-purple to-distill-violet px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-distill-purple/30 transition-all hover:from-distill-violet hover:to-distill-lavender"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

export function MarketingFooter() {
  const handleSmoothScroll = (
    e: React.MouseEvent<HTMLAnchorElement>,
    targetId: string,
  ) => {
    e.preventDefault();
    document.querySelector(targetId)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <footer className="border-t border-distill-purple/30 bg-dark-slate py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-12 grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-12 lg:grid-cols-4">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <Image
                src="/favicon.svg"
                alt="bureau"
                width={32}
                height={32}
                className="h-8 w-8"
              />
              <span className="text-xl font-bold text-cream">bureau</span>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-cream/60">
              Your local-first agent office for orchestrating multiple Claude
              Code sessions from one browser.
            </p>
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/dotbrains/bureau"
                className="text-cream/60 transition-colors hover:text-cream"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
              >
                <Github className="h-5 w-5" />
              </a>
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-cream">
              Product
            </h4>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/#features"
                  onClick={(e) => handleSmoothScroll(e, '#features')}
                  className="inline-block cursor-pointer text-sm text-cream/70 transition-colors hover:text-cream"
                >
                  Features
                </Link>
              </li>
              <li>
                <Link
                  href="/#how-it-works"
                  onClick={(e) => handleSmoothScroll(e, '#how-it-works')}
                  className="inline-block cursor-pointer text-sm text-cream/70 transition-colors hover:text-cream"
                >
                  How It Works
                </Link>
              </li>
              <li>
                <Link
                  href="/#use-cases"
                  onClick={(e) => handleSmoothScroll(e, '#use-cases')}
                  className="inline-block cursor-pointer text-sm text-cream/70 transition-colors hover:text-cream"
                >
                  Use Cases
                </Link>
              </li>
              <li>
                <Link
                  href="/#quick-start"
                  onClick={(e) => handleSmoothScroll(e, '#quick-start')}
                  className="inline-block cursor-pointer text-sm text-cream/70 transition-colors hover:text-cream"
                >
                  Quick Start
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-cream">
              Resources
            </h4>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://github.com/dotbrains/bureau#readme"
                  className="inline-flex items-center gap-1.5 text-sm text-cream/70 transition-colors hover:text-cream"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  README
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/dotbrains/bureau/blob/master/articles/design-and-architecture.md"
                  className="inline-flex items-center gap-1.5 text-sm text-cream/70 transition-colors hover:text-cream"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Design & Architecture
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/dotbrains/bureau/blob/master/CLAUDE.md"
                  className="inline-flex items-center gap-1.5 text-sm text-cream/70 transition-colors hover:text-cream"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Developer Guide
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-cream">
              Community
            </h4>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://github.com/dotbrains/bureau"
                  className="inline-flex items-center gap-1.5 text-sm text-cream/70 transition-colors hover:text-cream"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub Repository
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/dotbrains/bureau/issues"
                  className="inline-flex items-center gap-1.5 text-sm text-cream/70 transition-colors hover:text-cream"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Report Issues
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/dotbrains/bureau/discussions"
                  className="inline-flex items-center gap-1.5 text-sm text-cream/70 transition-colors hover:text-cream"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Discussions
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="flex flex-col items-center justify-between gap-4 border-t border-distill-purple/30 pt-8 md:flex-row">
          <p className="text-sm text-cream/60">
            © {new Date().getFullYear()} dotbrains. All rights reserved.
          </p>
          <p className="text-xs text-cream/50">
            Licensed under PolyForm Shield 1.0.0
          </p>
        </div>
      </div>
    </footer>
  );
}
