import { listAllAgentIdsOnDisk, listAllCronjobIdsOnDisk, loadAgentHistory, loadCronjobHistory } from "../../persistence.ts";
import { listCronjobs, readCronjobLifetimeUsage } from "../../cronjobs/index.ts";
import { agents, rooms } from "../state.ts";
import { addBucket, emptyBucket, formatInCell, formatTokenCount, formatUsd, type UsageBucket } from "../usage-format.ts";
import { readAgentUsage } from "./data.ts";

// ---------------------------------------------------------------------------
// /usage renderer — assembles the markdown report
// ---------------------------------------------------------------------------

export function renderUsageReport(): string {
  const lines: string[] = [];

  // Office-wide table: per-agent session and lifetime usage. "In" is all
  // input tiers summed (raw + cache read + cache creation); the inline "%
  // hit" is cache hit rate over cacheable input. Markdown only supports a
  // single header row, so session/lifetime groupings are encoded as
  // parenthesised suffixes on each column.
  lines.push(`## Agent usage`);
  lines.push("");
  lines.push(`| Agent | Room | In (sess) | Out (sess) | $ (sess) | In (life) | Out (life) | $ (life) |`);
  lines.push(`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  const rows = [...agents.values()].map((a) => {
    const usage = readAgentUsage(a.info.id, a.sessionId);
    const roomName = rooms[a.info.room]?.name ?? "?";
    return { id: a.info.id, name: a.info.name, room: roomName, sess: usage.session, life: usage.lifetime };
  });
  rows.sort((a, b) => b.life.costUSD - a.life.costUSD);
  for (const r of rows) {
    lines.push(
      `| ${r.name} | ${r.room} | ${formatInCell(r.sess)} | ${formatTokenCount(r.sess.totalOut)} | ${formatUsd(r.sess.costUSD)} | ${formatInCell(r.life)} | ${formatTokenCount(r.life.totalOut)} | ${formatUsd(r.life.costUSD)} |`,
    );
  }

  // Per-room totals + grand total. Each agent (live or killed) contributes to
  // the room it was last in — resolved via agent-history.json, which persists
  // each live agent's room on every persistAll. Rooms that have since been
  // deleted still appear, labeled "(deleted)", so prior spend isn't lost.
  // Buckets are keyed by stable roomId; current-room names override historical
  // names so renames are reflected immediately.
  const liveAgentIds = new Set([...agents.values()].map((a) => a.info.id));
  const history = loadAgentHistory();
  type RoomBucket = { id: string; name: string; deleted: boolean; sess: UsageBucket; life: UsageBucket };
  const roomBuckets = new Map<string, RoomBucket>();
  const getBucket = (id: string, name: string, deleted: boolean): RoomBucket => {
    let b = roomBuckets.get(id);
    if (!b) {
      b = { id, name, deleted, sess: emptyBucket(), life: emptyBucket() };
      roomBuckets.set(id, b);
    }
    return b;
  };
  // Seed with all current rooms so they show even when empty.
  for (const r of rooms) getBucket(r.id, r.name, false);

  for (const a of agents.values()) {
    const room = rooms[a.info.room];
    if (!room) continue;
    const usage = readAgentUsage(a.info.id, a.sessionId);
    const b = getBucket(room.id, room.name, false);
    addBucket(b.sess, usage.session);
    addBucket(b.life, usage.lifetime);
  }
  for (const id of listAllAgentIdsOnDisk()) {
    if (liveAgentIds.has(id)) continue;
    const h = history[id];
    // Killed agents without a history entry predate this feature; drop into a
    // synthetic bucket so their spend is still counted toward the grand total.
    const roomId = h?.lastRoomId ?? "__unknown__";
    const currentRoom = rooms.find((r) => r.id === roomId);
    const name = currentRoom?.name ?? h?.lastRoomName ?? "(unknown room)";
    const deleted = !currentRoom;
    const usage = readAgentUsage(id, null);
    const b = getBucket(roomId, name, deleted);
    addBucket(b.life, usage.lifetime);
  }

  const total = { sess: emptyBucket(), life: emptyBucket() };
  for (const b of roomBuckets.values()) {
    addBucket(total.sess, b.sess);
    addBucket(total.life, b.life);
  }

  const sortedBuckets = [...roomBuckets.values()].sort((a, b) => b.life.costUSD - a.life.costUSD);

  lines.push("");
  lines.push(`## Per-room usage`);
  lines.push("");
  lines.push(`_Agents contribute to the room they were last in (killed agents included)._`);
  lines.push("");
  lines.push(`| Room | In (sess) | Out (sess) | $ (sess) | In (life) | Out (life) | $ (life) |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of sortedBuckets) {
    const label = r.deleted ? `${r.name} _(deleted)_` : r.name;
    lines.push(
      `| ${label} | ${formatInCell(r.sess)} | ${formatTokenCount(r.sess.totalOut)} | ${formatUsd(r.sess.costUSD)} | ${formatInCell(r.life)} | ${formatTokenCount(r.life.totalOut)} | ${formatUsd(r.life.costUSD)} |`,
    );
  }

  // Per-cronjob lifetime usage (no per-session column — every run is its own
  // session). Includes cronjobs whose configs are deleted, attributed via
  // cronjob-history.json. Folded into the office-wide grand total below so
  // the bottom line is honest about total spend.
  type CronjobRow = { id: string; name: string; deleted: boolean; life: UsageBucket };
  const cronjobRows: CronjobRow[] = [];
  const liveCronjobs = listCronjobs();
  const liveCronjobIds = new Set(liveCronjobs.map((c) => c.id));
  const cronjobHistory = loadCronjobHistory();
  for (const c of liveCronjobs) {
    const u = readCronjobLifetimeUsage(c.id);
    cronjobRows.push({ id: c.id, name: c.name, deleted: false, life: { totalIn: u.totalIn, cacheRead: u.cacheRead, cacheCreation: u.cacheCreation, totalOut: u.totalOut, costUSD: u.costUSD } });
  }
  for (const id of listAllCronjobIdsOnDisk()) {
    if (liveCronjobIds.has(id)) continue;
    const name = cronjobHistory[id]?.lastName ?? id;
    const u = readCronjobLifetimeUsage(id);
    cronjobRows.push({ id, name, deleted: true, life: { totalIn: u.totalIn, cacheRead: u.cacheRead, cacheCreation: u.cacheCreation, totalOut: u.totalOut, costUSD: u.costUSD } });
  }

  const cronjobTotal = emptyBucket();
  for (const c of cronjobRows) addBucket(cronjobTotal, c.life);
  cronjobRows.sort((a, b) => b.life.costUSD - a.life.costUSD);

  if (cronjobRows.length > 0) {
    lines.push("");
    lines.push(`## Per-cron job usage`);
    lines.push("");
    lines.push(`_Lifetime totals across every run of each cron job._`);
    lines.push("");
    lines.push(`| Cron job | In (life) | Out (life) | $ (life) |`);
    lines.push(`| --- | ---: | ---: | ---: |`);
    for (const r of cronjobRows) {
      const label = r.deleted ? `${r.name} _(deleted)_` : r.name;
      lines.push(`| ${label} | ${formatInCell(r.life)} | ${formatTokenCount(r.life.totalOut)} | ${formatUsd(r.life.costUSD)} |`);
    }
  }

  // Office-wide grand total: per-room + per-cronjob, so the bottom line
  // reflects every dollar the office spent.
  const officeTotalLife = emptyBucket();
  addBucket(officeTotalLife, total.life);
  addBucket(officeTotalLife, cronjobTotal);

  lines.push(
    `| **Office total** | ${formatInCell(total.sess)} | ${formatTokenCount(total.sess.totalOut)} | ${formatUsd(total.sess.costUSD)} | ${formatInCell(officeTotalLife)} | ${formatTokenCount(officeTotalLife.totalOut)} | ${formatUsd(officeTotalLife.costUSD)} |`,
  );

  return lines.join("\n");
}
