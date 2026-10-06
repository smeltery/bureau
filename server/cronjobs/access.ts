import type { Cronjob, CronjobRun, UserRecord } from "../../shared/types.ts";
import { getUserById, getUserByName } from "../users.ts";
import { loadCronjobHistory } from "../persistence/cronjobs.ts";

export type ScheduleViewer = Pick<UserRecord, "id" | "role" | "allowedRooms">;

export function legacyScheduleRoom(userId: string | null, username?: string | null): string | null {
  const user = (userId ? getUserById(userId) : null) ?? (username ? getUserByName(username) : null);
  return user?.defaultRoomId ?? user?.allowedRooms[0] ?? null;
}

export function canViewSchedule(user: ScheduleViewer | null, job: Pick<Cronjob, "roomId" | "userId">): boolean {
  if (!user) return false;
  if (user.role === "owner") return true;
  return job.roomId ? user.allowedRooms.includes(job.roomId) : job.userId === user.id;
}

export function canManageSchedule(user: ScheduleViewer | null, job: Pick<Cronjob, "roomId" | "userId">): boolean {
  return canViewSchedule(user, job) && (user?.role === "owner" || user?.id === job.userId);
}

export function canViewRun(user: ScheduleViewer | null, run: CronjobRun): boolean {
  const history = loadCronjobHistory()[run.cronjobId];
  return canViewSchedule(user, {
    roomId: run.roomIdSnapshot === undefined ? history?.roomId : run.roomIdSnapshot,
    userId: run.userIdSnapshot === undefined ? (history?.userId ?? null) : run.userIdSnapshot,
  });
}
