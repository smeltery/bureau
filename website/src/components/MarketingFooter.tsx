"use client";

import { ExternalLink, Github } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { handleMarketingScroll } from "./marketingScroll";

export function MarketingFooter() {
  return (
    <footer className="border-t border-distill-purple/30 bg-dark-slate py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-12 grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-12 lg:grid-cols-4">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <Image src="/favicon.svg" alt="bureau" width={32} height={32} className="h-8 w-8" />
              <span className="text-xl font-bold text-cream">bureau</span>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-cream/60">Your local-first agent office for orchestrating multiple Claude Code sessions from one browser.</p>
            <div className="flex items-center gap-3">
              <a href="https://github.com/dotbrains/bureau" className="text-cream/60 transition-colors hover:text-cream" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
                <Github className="h-5 w-5" />
              </a>
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-cream">Product</h4>
            <ul className="space-y-3">
              <li>
                <Link href="/#features" onClick={(e) => handleMarketingScroll(e, "#features")} className="inline-block cursor-pointer text-sm text-cream/70 transition-colors hover:text-cream">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/#how-it-works" onClick={(e) => handleMarketingScroll(e, "#how-it-works")} className="inline-block cursor-pointer text-sm text-cream/70 transition-colors hover:text-cream">
                  How It Works
                </Link>
              </li>
              <li>
                <Link href="/#use-cases" onClick={(e) => handleMarketingScroll(e, "#use-cases")} className="inline-block cursor-pointer text-sm text-cream/70 transition-colors hover:text-cream">
                  Use Cases
                </Link>
              </li>
              <li>
                <Link href="/#quick-start" onClick={(e) => handleMarketingScroll(e, "#quick-start")} className="inline-block cursor-pointer text-sm text-cream/70 transition-colors hover:text-cream">
                  Quick Start
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-cream">Resources</h4>
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
                  href="https://github.com/dotbrains/bureau/blob/master/articles/punching-in-building-an-office-for-ai-agents.md"
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
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-cream">Community</h4>
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
          <p className="text-sm text-cream/60">© {new Date().getFullYear()} dotbrains. All rights reserved.</p>
          <p className="text-xs text-cream/50">Licensed under PolyForm Shield 1.0.0</p>
        </div>
      </div>
    </footer>
  );
}
