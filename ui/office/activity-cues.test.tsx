// Mid-turn cues: scrolling monitor lines, face screen-light, drink steam.
// Driven by agent state, not a timer — waiting/error light the screen but do not work.

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentState } from "../../shared/types.ts";
import { SKIN_COLORS } from "../../shared/outfit-options.ts";
import { Character, faceLitColor } from "./scene/Character.tsx";
import { DeskSprite } from "./scene/DeskSprite.tsx";

const OUTFIT = {
  color: "#4A90D9",
  hair: "#222",
  hairStyle: "short" as const,
  skin: "#FFD5B8",
  beard: "none" as const,
  accessory: null,
  hat: "none" as const,
};

const MID_TURN_BY_STATE: Record<AgentState, boolean> = {
  thinking: true,
  tool_executing: true,
  idle: false,
  waiting_for_response: false,
  error: false,
  stopped: false,
};
const states = (midTurn: boolean) => (Object.keys(MID_TURN_BY_STATE) as AgentState[]).filter((s) => MID_TURN_BY_STATE[s] === midTurn);
const MID_TURN = states(true);
const NOT_MID_TURN = states(false);

const desk = (state: AgentState, agentType: "claude" | "codex" | "opencode" = "claude") => renderToStaticMarkup(<DeskSprite state={state} agentType={agentType} />);

describe("monitor", () => {
  it("scrolls output past only while the agent is mid-turn", () => {
    for (const state of MID_TURN) expect([state, desk(state).includes("data-screen-scroll")]).toEqual([state, true]);
    for (const state of NOT_MID_TURN) expect([state, desk(state).includes("data-screen-scroll")]).toEqual([state, false]);
  });

  it("shows the idle sweep and the scrolling lines at different times", () => {
    const markup = desk("thinking");
    expect(markup.includes("data-screen-scroll")).toBe(true);
    for (const state of ["waiting_for_response", "error"] as AgentState[]) {
      expect([state, desk(state).includes("data-screen-scroll")]).toEqual([state, false]);
    }
  });
});

describe("drink", () => {
  for (const vessel of ["claude", "codex", "opencode"] as const) {
    it(`steams from a ${vessel} desk only while the agent is mid-turn`, () => {
      for (const state of MID_TURN) expect([state, desk(state, vessel).includes("data-steam")]).toEqual([state, true]);
      for (const state of NOT_MID_TURN) expect([state, desk(state, vessel).includes("data-steam")]).toEqual([state, false]);
    });
  }
});

describe("face", () => {
  const character = (state: AgentState) => renderToStaticMarkup(<Character state={state} outfit={OUTFIT} />);

  it("catches the screen light only while the agent is mid-turn", () => {
    for (const state of MID_TURN) expect([state, character(state).includes("data-face-light")]).toEqual([state, true]);
    for (const state of NOT_MID_TURN) expect([state, character(state).includes("data-face-light")]).toEqual([state, false]);
  });

  it("paints the light in the face's own skin, not in a colour of its own", () => {
    for (const tone of SKIN_COLORS) {
      const markup = renderToStaticMarkup(<Character state="thinking" outfit={{ ...OUTFIT, skin: tone }} />);
      const lit = faceLitColor(tone);
      const stops = [...markup.matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1]);
      expect([tone, stops.length > 0]).toEqual([tone, true]);
      expect([tone, new Set(stops)]).toEqual([tone, new Set([lit])]);
    }
  });

  it("returns a colour it cannot read untouched", () => {
    for (const bad of ["", "cornflower", "#12", "#ggghhh", "rgb(1,2,3)"]) expect(faceLitColor(bad)).toBe(bad);
  });

  it("gives every character its own light definitions", () => {
    const two = renderToStaticMarkup(
      <>
        <Character state="thinking" outfit={OUTFIT} />
        <Character state="thinking" outfit={OUTFIT} />
      </>,
    );
    const ids = [...two.matchAll(/id="(face-[a-z]+-[^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("face light, across every skin the picker offers", () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lifts = SKIN_COLORS.map((tone) => {
    const base = rgb(tone);
    const lit = rgb(faceLitColor(tone));
    return { tone, base, lit, gain: lit.map((v, i) => v - base[i]) };
  });

  it("gains the same light on every skin, channel by channel", () => {
    for (const a of lifts) {
      for (const b of lifts) {
        for (let ch = 0; ch < 3; ch++) {
          if (a.lit[ch] === 255 || b.lit[ch] === 255) continue;
          expect([a.tone, b.tone, ch, a.gain[ch]]).toEqual([a.tone, b.tone, ch, b.gain[ch]]);
        }
      }
    }
  });

  it("stays faint on the darkest skin and stays visible on the palest", () => {
    const peaks = lifts.map((l) => ({ tone: l.tone, peak: Math.max(...l.gain) }));
    for (const { tone, peak } of peaks) {
      expect([tone, peak >= 24, peak <= 44]).toEqual([tone, true, true]);
    }
    const spread = Math.max(...peaks.map((p) => p.peak)) - Math.min(...peaks.map((p) => p.peak));
    expect(spread).toBeLessThanOrEqual(6);
  });

  it("leaves every lit face still its own colour", () => {
    const darkest = rgb(faceLitColor("#5C3A28"));
    const palest = rgb("#FDEBD0");
    for (let ch = 0; ch < 3; ch++) expect([ch, darkest[ch] < palest[ch] - 60]).toEqual([ch, true]);
  });
});
