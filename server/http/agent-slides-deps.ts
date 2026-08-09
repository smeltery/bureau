// The production wiring for the Slide Mode routes: the real agent manager and
// the real read rule. Split from agent-slides.ts so the handler file imports only
// the SEAM (as a type) and a test can inject fakes without the module graph
// pulling in the agent manager or the slide generator.

import * as AgentManager from "../agent-manager.ts";
import { requireAgentLogAccess } from "./agents.ts";
import type { SlideRoutesDeps } from "./agent-slides.ts";

export const defaultSlideRoutesDeps: SlideRoutesDeps = {
  // The same rule as GET /api/agents/:id/logs — a slide is a rendering of the
  // conversation, so it can be no easier to reach than the conversation.
  requireAccess: (req, auth, agentId) => requireAgentLogAccess(req, auth, agentId),
  getSlideDeck: (agentId) => AgentManager.getSlideDeck(agentId),
  ensureSlide: (agentId, entryId, opts) => AgentManager.ensureSlide(agentId, entryId, opts),
};
