'use client';

import React from 'react';
import { MarketingNav, MarketingFooter } from '@/components/MarketingLayout';
import { HeroSection } from '@/components/sections/HeroSection';
import { StatsSection } from '@/components/sections/StatsSection';
import { FeaturesSection } from '@/components/sections/FeaturesSection';
import { HowItWorksSection } from '@/components/sections/HowItWorksSection';
import { CodeExamplesSection } from '@/components/sections/CodeExamplesSection';
import { UseCasesSection } from '@/components/sections/UseCasesSection';
import { QuickStartSection } from '@/components/sections/QuickStartSection';
import { CTASection } from '@/components/sections/CTASection';
import { PaperSection } from '@/components/sections/PaperSection';

export default function Page() {
  const scrollToFeatures = () => {
    document.querySelector('#features')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-dark-slate">
      <MarketingNav transparent />
      <HeroSection onLearnMore={scrollToFeatures} />
      <StatsSection />
      <FeaturesSection />
      <HowItWorksSection />
      <CodeExamplesSection />
      <UseCasesSection />
      <QuickStartSection />
      <PaperSection />
      <CTASection />
      <MarketingFooter />
    </div>
  );
}
