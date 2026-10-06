import { Faq, Footer, Local } from './components/Details.tsx';
import { Features } from './components/Features.tsx';
import { Header, Hero, HowItWorks } from './components/Marketing.tsx';

export function App() {
  return (
    <>
      <Header />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Features />
        <Local />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
