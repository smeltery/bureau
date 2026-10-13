import { Workflows } from './components/Workflows.tsx';
import { Workspace } from './components/Workspace.tsx';
import { Hosting } from './components/Hosting.tsx';
import { Faq, Local } from './components/Details.tsx';
import { Features } from './components/Features.tsx';
import { Cta, Footer } from './components/Footer.tsx';
import { Header, Hero, HowItWorks } from './components/Marketing.tsx';

export function App() {
  return (
    <>
      <Header />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Workflows />
        <Workspace />
        <Features />
        <Local />
        <Hosting />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
