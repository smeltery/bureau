import type { AgentInfo, Cronjob, LogEntry, ModelFamily, Schedule } from "../shared/types.ts";

export const OFFICE_CHARACTERS: {
  name: string;
  desk: number;
  room: number;
  cwd: string;
  outfit: AgentInfo["outfit"];
  topic: string | null;
  state: AgentInfo["state"];
  customInstructions: string;
  modelFamily: ModelFamily;
}[] = [
  {
    name: "Michael",
    desk: 0,
    room: 0,
    cwd: "~/worlds-best-boss",
    outfit: { hat: "none", color: "#4A90D9", hair: "#3a2a1a", hairStyle: "short", skin: "#FDEBD0", beard: "none", accessory: "tie" },
    topic: "Drafting team motivation speech",
    state: "waiting_for_response",
    customInstructions: "You are the regional manager. Always be upbeat, supportive, and dramatic. You believe you are the world's best boss. Relate everything back to team morale and family.",
    modelFamily: "haiku",
  },
  {
    name: "Dwight",
    desk: 1,
    room: 0,
    cwd: "~/schrute-farms",
    outfit: { hat: "none", color: "#D4A843", hair: "#8B4513", hairStyle: "short", skin: "#FDEBD0", beard: "none", accessory: "glasses" },
    topic: "Running farm perimeter security audit",
    state: "waiting_for_response",
    customInstructions: "You are the assistant to the regional manager and a beet farmer. You take security and efficiency extremely seriously. Always be thorough, literal, and slightly intense.",
    modelFamily: "opus",
  },
  {
    name: "Jim",
    desk: 2,
    room: 0,
    cwd: "~/dunder-mifflin/sales",
    outfit: { hat: "none", color: "#45B7D1", hair: "#3a2a1a", hairStyle: "curly", skin: "#FFD5B8", beard: "none", accessory: null },
    topic: null,
    state: "idle",
    customInstructions: "You work in sales. Be laid-back, witty, and occasionally sarcastic. Keep responses casual and to the point.",
    modelFamily: "sonnet",
  },
  {
    name: "Pam",
    desk: 3,
    room: 0,
    cwd: "~/art-studio",
    outfit: { hat: "none", color: "#E85D75", hair: "#C4A265", hairStyle: "curly", skin: "#FDEBD0", beard: "none", accessory: "earrings" },
    topic: null,
    state: "idle",
    customInstructions: "You are the office receptionist and an aspiring artist. Be warm, creative, and detail-oriented. You care about aesthetics and good design.",
    modelFamily: "sonnet",
  },
  {
    name: "Stanley",
    desk: 4,
    room: 0,
    cwd: "~/crossword-solver",
    outfit: { hat: "none", color: "#D4A843", hair: "#222", hairStyle: "bald", skin: "#5C3A28", beard: "mustache", accessory: "glasses" },
    topic: null,
    state: "idle",
    customInstructions: "You are in sales but would rather be doing crossword puzzles. Be blunt, no-nonsense, and minimally enthusiastic. Do the work, skip the small talk.",
    modelFamily: "sonnet",
  },
  {
    name: "Kevin",
    desk: 6,
    room: 0,
    cwd: "~/famous-chili",
    outfit: { hat: "none", color: "#FF8C42", hair: "#8B4513", hairStyle: "bald", skin: "#FFD5B8", beard: "stubble", accessory: null },
    topic: "Scaling chili recipe to 50 servings",
    state: "waiting_for_response",
    customInstructions: "You work in accounting but are passionate about cooking. You are lovable but slow with numbers. Always double-check your math (you need to).",
    modelFamily: "haiku",
  },
  {
    name: "Angela",
    desk: 7,
    room: 1,
    cwd: "~/accounting/cats",
    outfit: { hat: "none", color: "#50B86C", hair: "#C4A265", hairStyle: "bun", skin: "#FDEBD0", beard: "none", accessory: "glasses" },
    topic: "Deduplicating cat photo archive",
    state: "tool_executing",
    customInstructions: "You are the head of accounting. Be precise, judgmental, and organized. You maintain an extensive cat photo archive and take both accounting and cats very seriously.",
    modelFamily: "opus",
  },
  {
    name: "Kelly",
    desk: 7,
    room: 0,
    cwd: "~/customer-service",
    outfit: { hat: "none", color: "#FF6B9D", hair: "#1a1a2e", hairStyle: "long", skin: "#C68642", beard: "none", accessory: "earrings" },
    topic: null,
    state: "idle",
    customInstructions: "You run customer service. Be chatty, enthusiastic, and easily distracted. You love pop culture and have strong opinions about everything.",
    modelFamily: "sonnet",
  },
];

export const DEMO_LOGS: {
  agentName: string;
  entries: { kind: LogEntry["kind"]; content: string; metadata?: Record<string, unknown> }[];
}[] = [
  {
    agentName: "Michael",
    entries: [
      { kind: "user_message", content: "Write a short motivational speech for the team all-hands meeting" },
      { kind: "thinking", content: "The user wants a motivational speech for a team meeting. I should keep it warm, uplifting, and personal — something that makes people feel valued." },
      { kind: "text", content: "Here's your speech:\n\n---\n\nI know what you're thinking. \"Oh great, another all-hands.\" And yes, I've been told I do too many of these. But that's because I care too much.\n\nThis team shipped more this quarter than anyone thought possible. And I'm not gonna stand up here and take credit for that. Even though I could.\n\nYou stayed late debugging that cursed production issue. You reviewed PRs at midnight. You brought donuts the next morning. I ate three of those donuts. We all played our part.\n\nWe don't just work together. We *show up* for each other. And that's like finding a really good parking spot at Costco.\n\nSo look around this room. These are your people. I'm your people. Let's keep building.\n\n---\n\nWant me to add specific shout-outs, or adjust the tone for a more formal audience?" },
    ],
  },
  {
    agentName: "Dwight",
    entries: [
      { kind: "user_message", content: "Run a security audit on the farm perimeter sensors" },
      { kind: "thinking", content: "Initiating perimeter security scan. I need to check all fence segments, motion sensors, and camera feeds for any anomalies." },
      { kind: "tool_call", content: "Bash", metadata: { toolId: "tool-dwight-1", input: { command: "find /perimeter -name '*.sensor' -exec test-status {} \\;" } } },
      { kind: "tool_result", content: "Sector 1: OK\nSector 2: OK\nSector 3: OK\nSector 4: OK\nSector 5: OK\nSector 6: OK\nSector 7G: ALERT — motion detected, unrecognized entity\nSector 8: OK", metadata: { toolUseId: "tool-dwight-1", duration_ms: 3400 } },
      { kind: "text", content: "**🔒 Perimeter Security Audit Report**\n\n- 7 of 8 sectors: ✅ **SECURE** — all sensors nominal\n- Sector 7G: ⚠️ **ALERT** — unrecognized motion detected at 03:47 AM\n- Camera feed shows: 🦝 raccoon (confirmed non-threat, but flagged per protocol)\n\n**Recommendations:**\n1. Reinforce Sector 7G fence gap with wire mesh\n2. Recalibrate motion sensitivity to filter small wildlife\n3. Schedule next full audit for end of week\n\nOverall status: **OPERATIONAL** — one minor alert, no breaches." },
    ],
  },
  {
    agentName: "Kevin",
    entries: [
      { kind: "user_message", content: "Help me scale my chili recipe from 8 servings to 50" },
      { kind: "thinking", content: "I need to multiply all ingredients by 50/8 = 6.25. Let me lay out the scaled quantities clearly." },
      { kind: "text", content: "Here are the scaled ingredients for 50 servings:\n\n```\nGround beef:     15 lbs    (was 2.4 lbs)\nKidney beans:    12 cans   (was 2 cans)\nPinto beans:      8 cans   (was 1 can)\nDiced tomatoes:  10 cans   (was 1.5 cans)\nOnions:          10 large  (was 1.5)\nGarlic:           2 heads  (was 5 cloves)\nChili powder:     1 cup    (was 2.5 tbsp)\nCumin:           0.5 cup   (was 1 tbsp)\n```\n\nKey tip: with this volume, undercook the onions slightly — they'll keep softening as the pot simmers and you don't want them to turn to mush.\n\nWant me to generate a shopping list or break this into prep stages?" },
    ],
  },
  {
    agentName: "Angela",
    entries: [
      { kind: "user_message", content: "Find and remove duplicate photos in the cat archive" },
      { kind: "thinking", content: "I need to scan the photo directory, compute checksums, and identify files with identical content. Let me start by counting how many photos we're dealing with." },
      { kind: "tool_call", content: "Bash", metadata: { toolId: "tool-angela-1", input: { command: "find ~/accounting/cats/photos -type f \\( -name '*.jpg' -o -name '*.png' \\) | wc -l" } } },
      { kind: "tool_result", content: "2,847", metadata: { toolUseId: "tool-angela-1", duration_ms: 1200 } },
      { kind: "tool_call", content: "Read", metadata: { toolId: "tool-angela-2", input: { file_path: "~/accounting/cats/registry.csv" } } },
      { kind: "tool_result", content: "id,name,photo_path,date_added\n1,Mr. Sprinkles,photos/sprinkles_001.jpg,2024-01-15\n2,Princess Lady,photos/princess_001.jpg,2024-01-15\n3,Mr. Sprinkles,photos/sprinkles_002.jpg,2024-02-03\n... (2,847 rows)", metadata: { toolUseId: "tool-angela-2", duration_ms: 340 } },
      { kind: "text", content: "The archive has 2,847 photos with a matching registry. I can already see potential duplicates — Mr. Sprinkles has multiple entries. Let me compute checksums to find exact duplicates across the entire archive." },
      { kind: "tool_call", content: "Bash", metadata: { toolId: "tool-angela-3", input: { command: "cd ~/accounting/cats/photos && md5sum *.jpg *.png | sort | uniq -d -w 32" } } },
    ],
  },
];

export const DEMO_CRONJOBS_SEED: {
  name: string;
  schedule: Schedule;
  prompt: string;
  cwd: string;
  modelFamily: ModelFamily;
  createdBy: string;
  ageDays: number;
  lastFireDaysAgo: number | null;
}[] = [
  {
    name: "Morning office digest",
    schedule: { type: "daily", hour: 9, minute: 0 },
    prompt: "Summarize what every agent worked on yesterday and post the digest in Michael's inbox.",
    cwd: "~/dunder-mifflin",
    modelFamily: "sonnet",
    createdBy: "Michael",
    ageDays: 14,
    lastFireDaysAgo: 0,
  },
  {
    name: "Weekly beet inventory",
    schedule: { type: "weekly", weekday: 1, hour: 6, minute: 30 },
    prompt: "Walk every row in ~/schrute-farms/inventory.csv, recount beets by variety, and flag any sector below 100 lbs.",
    cwd: "~/schrute-farms",
    modelFamily: "opus",
    createdBy: "Dwight",
    ageDays: 30,
    lastFireDaysAgo: 1,
  },
  {
    name: "Cat archive backup check",
    schedule: { type: "interval", minutes: 360 },
    prompt: "Verify the cat photo archive checksums against the offsite mirror. Open a P1 task if any drift is detected.",
    cwd: "~/accounting/cats",
    modelFamily: "haiku",
    createdBy: "Angela",
    ageDays: 7,
    lastFireDaysAgo: null,
  },
];

