'use client';

export function StatsSection() {
  return (
    <section className="bg-dark-gray/50 py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-8 text-center sm:mb-12">
          <h2 className="mb-3 text-2xl font-bold text-cream sm:mb-4 sm:text-3xl lg:text-4xl">
            Run parallel agents without orchestration sprawl
          </h2>
          <p className="text-base text-cream/70 sm:text-lg lg:text-xl">
            Bureau keeps your agents, terminals, and conversations in one shared office view
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 text-center sm:gap-6 md:grid-cols-4 md:gap-8">
          <div>
            <div className="mb-1 text-2xl font-bold text-gradient sm:mb-2 sm:text-3xl">Single Process</div>
            <div className="text-sm text-cream/60 sm:text-base">Bun Runtime</div>
          </div>
          <div>
            <div className="mb-1 text-2xl font-bold text-gradient sm:mb-2 sm:text-3xl">Persistent</div>
            <div className="text-sm text-cream/60 sm:text-base">Agent Sessions</div>
          </div>
          <div>
            <div className="mb-1 text-2xl font-bold text-gradient sm:mb-2 sm:text-3xl">Shared</div>
            <div className="text-sm text-cream/60 sm:text-base">Task Board</div>
          </div>
          <div>
            <div className="mb-1 text-2xl font-bold text-gradient sm:mb-2 sm:text-3xl">Built-In</div>
            <div className="text-sm text-cream/60 sm:text-base">Agent Terminals</div>
          </div>
        </div>
      </div>
    </section>
  );
}
