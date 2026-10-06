import { listAllAgentIdsOnDisk, listAllCronjobIdsOnDisk, loadAgentHistory, loadCronjobHistory, loadRuns } from "../../persistence.ts";
import { listCronjobs, readCronjobLifetimeUsage } from "../../cronjobs/index.ts";
import { agents, rooms } from "../state.ts";
import { addBucket, emptyBucket, formatInCell, formatTokenCount, formatUsd, type UsageBucket } from "../usage-format.ts";
import { readAgentUsage } from "./data.ts";
import type { CronjobUsageWire, RoomUsageWire, UsageReportWire, UserRecord } from "../../../shared/types.ts";

export type UsageAudience = { kind: "owner" } | { kind: "member"; roomIds: Set<string> };

function scheduleUsageRows(audience: UsageAudience): CronjobUsageWire[] {
  const live = listCronjobs();
  const history = loadCronjobHistory();
  const ids = new Set([...live.map((job) => job.id), ...listAllCronjobIdsOnDisk()]);
  const rows: CronjobUsageWire[] = [];
  for (const id of ids) {
    const job = live.find((item) => item.id === id);
    const visible = (run: import("../../../shared/types.ts").CronjobRun) => audienceCanSeeRoom(audience, run.roomIdSnapshot === undefined ? history[id]?.roomId : run.roomIdSnapshot);
    const runs = loadRuns(id).filter(visible);
    const seesJob = audienceCanSeeRoom(audience, job?.roomId ?? history[id]?.roomId);
    if (!seesJob && !runs.length) continue;
    rows.push({ id, name: seesJob ? (job?.name ?? history[id]?.lastName ?? id) : runs.at(-1)!.cronjobName, deleted: !job, lifetime: readCronjobLifetimeUsage(id, visible) });
  }
  return rows.sort((a, b) => b.lifetime.costUSD - a.lifetime.costUSD);
}

export function usageAudienceForUser(user: UserRecord | null | undefined): UsageAudience {
  if (user?.role === "owner") return { kind: "owner" };
  return { kind: "member", roomIds: new Set(user?.allowedRooms ?? []) };
}

function audienceCanSeeRoom(audience: UsageAudience, roomId: string | null | undefined): boolean {
  if (audience.kind === "owner") return true;
  return !!roomId && audience.roomIds.has(roomId);
}

function cloneBucket(bucket: UsageBucket): UsageBucket {
  return { totalIn: bucket.totalIn, cacheRead: bucket.cacheRead, cacheCreation: bucket.cacheCreation, totalOut: bucket.totalOut, costUSD: bucket.costUSD };
}

export function buildUsageReportData(audience: UsageAudience = { kind: "owner" }): UsageReportWire {
  const visibleRooms = audience.kind === "owner" ? rooms : rooms.filter((room) => audience.roomIds.has(room.id));
  const roomBuckets = new Map<string, { id: string; name: string; deleted: boolean; session: UsageBucket; lifetime: UsageBucket }>();
  const getRoomBucket = (id: string, name: string, deleted: boolean) => {
    let bucket = roomBuckets.get(id);
    if (!bucket) {
      bucket = { id, name, deleted, session: emptyBucket(), lifetime: emptyBucket() };
      roomBuckets.set(id, bucket);
    }
    return bucket;
  };

  for (const room of visibleRooms) getRoomBucket(room.id, room.name, false);

  const agentRows = [...agents.values()]
    .filter((agent) => audienceCanSeeRoom(audience, rooms[agent.info.room]?.id))
    .map((agent) => {
      const room = rooms[agent.info.room];
      const usage = readAgentUsage(agent.info.id, agent.sessionId);
      if (room) {
        const roomBucket = getRoomBucket(room.id, room.name, false);
        addBucket(roomBucket.session, usage.session);
        addBucket(roomBucket.lifetime, usage.lifetime);
      }
      return {
        id: agent.info.id,
        name: agent.info.name,
        roomId: room?.id ?? "",
        roomName: room?.name ?? "?",
        session: cloneBucket(usage.session),
        lifetime: cloneBucket(usage.lifetime),
      };
    });
  agentRows.sort((a, b) => b.lifetime.costUSD - a.lifetime.costUSD);

  const liveAgentIds = new Set([...agents.values()].map((agent) => agent.info.id));
  const history = loadAgentHistory();
  for (const id of listAllAgentIdsOnDisk()) {
    if (liveAgentIds.has(id)) continue;
    const h = history[id];
    const roomId = h?.lastRoomId ?? "__unknown__";
    if (!audienceCanSeeRoom(audience, h?.lastRoomId)) continue;
    const currentRoom = rooms.find((room) => room.id === roomId);
    const name = currentRoom?.name ?? h?.lastRoomName ?? "(unknown room)";
    const usage = readAgentUsage(id, null);
    const roomBucket = getRoomBucket(roomId, name, !currentRoom);
    addBucket(roomBucket.lifetime, usage.lifetime);
  }

  const totalSession = emptyBucket();
  const totalLifetime = emptyBucket();
  const roomRows: RoomUsageWire[] = [...roomBuckets.values()]
    .map((room) => {
      addBucket(totalSession, room.session);
      addBucket(totalLifetime, room.lifetime);
      return { id: room.id, name: room.name, deleted: room.deleted, session: cloneBucket(room.session), lifetime: cloneBucket(room.lifetime) };
    })
    .sort((a, b) => b.lifetime.costUSD - a.lifetime.costUSD);

  const cronjobRows = scheduleUsageRows(audience);
  for (const row of cronjobRows) addBucket(totalLifetime, row.lifetime);

  return { scoped: audience.kind !== "owner", agents: agentRows, rooms: roomRows, cronjobs: cronjobRows, total: { session: cloneBucket(totalSession), lifetime: cloneBucket(totalLifetime) } };
}

// ---------------------------------------------------------------------------
// /usage renderer — assembles the markdown report
// ---------------------------------------------------------------------------

export function renderUsageReport(audience: UsageAudience = { kind: "owner" }): string {
  const lines: string[] = [];
  const visibleRooms = audience.kind === "owner" ? rooms : rooms.filter((room) => audience.roomIds.has(room.id));

  // Office-wide table: per-agent session and lifetime usage. "In" is all
  // input tiers summed (raw + cache read + cache creation); the inline "%
  // hit" is cache hit rate over cacheable input. Markdown only supports a
  // single header row, so session/lifetime groupings are encoded as
  // parenthesised suffixes on each column.
  lines.push(`## Agent usage`);
  lines.push("");
  lines.push(`| Agent | Room | In (sess) | Out (sess) | $ (sess) | In (life) | Out (life) | $ (life) |`);
  lines.push(`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  const rows = [...agents.values()]
    .filter((a) => audienceCanSeeRoom(audience, rooms[a.info.room]?.id))
    .map((a) => {
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
  for (const r of visibleRooms) getBucket(r.id, r.name, false);

  for (const a of agents.values()) {
    const room = rooms[a.info.room];
    if (!room || !audienceCanSeeRoom(audience, room.id)) continue;
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
    if (!audienceCanSeeRoom(audience, h?.lastRoomId)) continue;
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
  const cronjobRows = scheduleUsageRows(audience).map(({ lifetime, ...row }) => ({ ...row, life: lifetime }));

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

  const totalLabel = audience.kind === "owner" ? "Office total" : "Total";
  lines.push(
    `| **${totalLabel}** | ${formatInCell(total.sess)} | ${formatTokenCount(total.sess.totalOut)} | ${formatUsd(total.sess.costUSD)} | ${formatInCell(officeTotalLife)} | ${formatTokenCount(officeTotalLife.totalOut)} | ${formatUsd(officeTotalLife.costUSD)} |`,
  );

  return lines.join("\n");
}
