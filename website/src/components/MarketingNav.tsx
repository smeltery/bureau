"use client";

import { useState } from "react";
import { Github, Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { handleMarketingScroll } from "./marketingScroll";

interface MarketingNavProps {
  transparent?: boolean;
}

export function MarketingNav({ transparent = false }: MarketingNavProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => handleMarketingScroll(e, targetId, () => setMobileMenuOpen(false));

  return (
    <nav
      className={`fixed left-0 right-0 top-0 z-50 w-full px-4 py-4 backdrop-blur-xl transition-colors sm:px-6 ${transparent ? "bg-dark-slate/80" : "border-b border-distill-purple/30 bg-dark-slate"}`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80 sm:gap-3">
          <Image src="/ui-icon.svg" alt="bureau" width={32} height={32} className="h-7 w-7 sm:h-8 sm:w-8" />
          <span className="text-lg font-bold text-cream sm:text-xl">bureau</span>
        </Link>

        <div className="hidden items-center gap-8 lg:flex">
          <Link href="/#features" onClick={(e) => scrollToSection(e, "#features")} className="text-sm font-medium text-cream/80 transition-colors hover:text-cream">
            Features
          </Link>
          <Link href="/#how-it-works" onClick={(e) => scrollToSection(e, "#how-it-works")} className="text-sm font-medium text-cream/80 transition-colors hover:text-cream">
            How It Works
          </Link>
          <Link href="/#use-cases" onClick={(e) => scrollToSection(e, "#use-cases")} className="text-sm font-medium text-cream/80 transition-colors hover:text-cream">
            Use Cases
          </Link>
          <Link href="/#architecture" onClick={(e) => scrollToSection(e, "#architecture")} className="text-sm font-medium text-cream/80 transition-colors hover:text-cream">
            Architecture
          </Link>
          <div className="ml-2 flex items-center gap-3">
            <a
              href="https://github.com/smeltery/bureau"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-distill-purple bg-dark-gray px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-dark-slate"
            >
              <Github className="h-4 w-4" />
              <span>Star</span>
            </a>
            <Link
              href="/#quick-start"
              onClick={(e) => scrollToSection(e, "#quick-start")}
              className="rounded-lg bg-gradient-to-r from-distill-purple to-distill-violet px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-distill-purple/30 transition-all hover:from-distill-violet hover:to-distill-lavender"
            >
              Get Started
            </Link>
          </div>
        </div>

        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 text-cream transition-colors hover:text-distill-purple lg:hidden" aria-label="Toggle menu">
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="fixed left-0 right-0 top-[72px] z-40 border-b border-distill-purple/30 bg-dark-slate shadow-xl backdrop-blur-xl lg:hidden">
          <div className="space-y-4 px-4 py-6">
            <Link href="/#features" onClick={(e) => scrollToSection(e, "#features")} className="block py-2 text-base font-medium text-cream/80 transition-colors hover:text-cream">
              Features
            </Link>
            <Link href="/#how-it-works" onClick={(e) => scrollToSection(e, "#how-it-works")} className="block py-2 text-base font-medium text-cream/80 transition-colors hover:text-cream">
              How It Works
            </Link>
            <Link href="/#use-cases" onClick={(e) => scrollToSection(e, "#use-cases")} className="block py-2 text-base font-medium text-cream/80 transition-colors hover:text-cream">
              Use Cases
            </Link>
            <Link href="/#architecture" onClick={(e) => scrollToSection(e, "#architecture")} className="block py-2 text-base font-medium text-cream/80 transition-colors hover:text-cream">
              Architecture
            </Link>
            <div className="space-y-3 border-t border-distill-purple/20 pt-4">
              <a
                href="https://github.com/smeltery/bureau"
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-distill-purple bg-dark-gray px-4 py-3 text-sm font-medium text-cream transition-colors hover:bg-dark-slate"
              >
                <Github className="h-4 w-4" />
                <span>Star on GitHub</span>
              </a>
              <Link
                href="/#quick-start"
                onClick={(e) => scrollToSection(e, "#quick-start")}
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
