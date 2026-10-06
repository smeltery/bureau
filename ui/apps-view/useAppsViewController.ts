// The Apps tab's state: the polling loop, the verbs, the log pane and the
// delete confirmation. The view below it is markup only.

import { useEffect, useRef, useState } from "react";
import type { AppListWire } from "../../shared/apps.ts";
import { useAppState, useDispatch } from "../store.tsx";
import { getAppFilter, getAppPreviews, pruneAppPreviewOpens, setAppFilter, setAppPreviews, type AppFilter } from "../device-settings.ts";
import { controlApp, deleteApp, listApps, readAppLog } from "./appsApi.ts";
import { nextPollDelay, shouldCommit } from "./appsPolling.ts";
import { filterApps, sortApps, type AppVerb } from "./appVerbs.ts";
import { errMessage } from "../../shared/errors.ts";

export function useAppsViewController() {
  const { apps, appsLoaded, appsRevision, isMobile, hydrationEpoch, sessionContext } = useAppState();
  const dispatch = useDispatch();
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AppListWire | null>(null);
  const [previewsEnabled, setPreviewsEnabled] = useState(getAppPreviews);
  const [filters, setFilters] = useState<Record<AppFilter, boolean>>(() => ({
    hideStopped: getAppFilter("hideStopped"),
    onlyMine: getAppFilter("onlyMine"),
  }));
  const [openLogs, setOpenLogs] = useState<string | null>(null);
  // Moves when the USER changes what the log pane is showing — opening a row,
  // closing one, deleting the open one — so a request in flight can tell that it
  // no longer speaks for what is on screen.
  //
  // Deliberately NOT touched by any lifecycle event. Coupling it to the polling
  // effect's cleanup meant a rehydrate (which restarts that effect while the tab
  // and its open pane stay mounted) invalidated a pending log request that
  // nothing would then re-issue, stranding the pane on "Loading…" forever. An
  // unmount needs no bump either: the component is gone, so its setState is a
  // no-op, and inventing a lifecycle bump is what created the bug.
  const logGenRef = useRef(0);
  const openLogsRef = useRef<string | null>(null);
  const [logLines, setLogLines] = useState<string[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  // Mirrors the store's app revision so the async poll body reads the CURRENT
  // value rather than the one captured when its closure was created.
  const revisionRef = useRef(appsRevision);

  // Both refs sync in effects rather than during render (writing a ref while
  // rendering is the anti-pattern the lint rule names). Neither has to be exact
  // at every instant:
  //   - openLogsRef is also set imperatively by toggleLogs, which is what the
  //     in-flight request actually races against; this only backstops it.
  //   - revisionRef lagging by a commit can only make the poll capture a value
  //     that is too LOW, and the reducer then refuses a snapshot it might have
  //     accepted. Refusing a good snapshot costs a re-fetch; accepting a stale
  //     one is the bug.
  useEffect(() => {
    openLogsRef.current = openLogs;
  }, [openLogs]);
  useEffect(() => {
    revisionRef.current = appsRevision;
  }, [appsRevision]);

  useEffect(() => {
    if (!appsLoaded) return;
    pruneAppPreviewOpens(apps.flatMap((app) => (typeof app.url === "string" && app.url !== "" ? [app.url] : [])));
  }, [apps, appsLoaded]);

  // Fetch on mount and on every rehydration, then poll while open.
  //
  // hydrationEpoch, NOT `connected`: ws.ts reconnects a frozen mobile socket
  // without the connected flag ever going false, so an effect keyed on that
  // edge would silently never re-run and this list would sit on whatever it
  // held before the gap.
  //
  // `cancelled` is a LOCAL of each effect run, not a ref, and that is the whole
  // point. A shared ref cannot name a lifecycle: on a rehydrate the outgoing
  // cleanup would clear it and the incoming effect would immediately set it
  // again, so the outgoing loop — still awaiting its fetch — would wake up, see
  // a live flag, and schedule itself alongside the new one. Every rehydrate
  // would leave another poll loop running. A local can only ever be cancelled.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // SINGLE FLIGHT: the next fetch is scheduled when the last one finishes,
    // never on a fixed interval. Against a sick supervisor, where a list can
    // take longer than the poll period, an interval would pile up requests that
    // are all obsolete before they land.
    const tick = async () => {
      // The revision AS OF THE REQUEST. Anything the deltas do while this is in
      // flight moves it, and the reducer then refuses this now-older snapshot.
      const revision = revisionRef.current;
      let landed = true;
      try {
        const list = await listApps();
        if (cancelled) return;
        dispatch({ type: "apps_loaded", apps: list, revision });
        setError(null);
        // A snapshot beaten by a delta is refused by the reducer, so come back
        // for a current one instead of leaving the list short for a full tick.
        landed = revision === revisionRef.current;
      } catch (err) {
        if (cancelled) return;
        setError(errMessage(err, "Could not load apps."));
      }
      const delay = nextPollDelay(cancelled, landed);
      if (delay === null) return;
      timer = setTimeout(() => void tick(), delay);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [dispatch, hydrationEpoch]);

  async function act(name: string, verb: AppVerb) {
    setBusy(`${name}:${verb}`);
    setError(null);
    try {
      const app = await controlApp(name, verb);
      dispatch({ type: "app_updated", app });
    } catch (err) {
      setError(errMessage(err, `Could not ${verb}.`));
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(app: AppListWire) {
    setBusy(`${app.name}:delete`);
    setError(null);
    try {
      await deleteApp(app.name);
      dispatch({ type: "app_removed", name: app.name });
      setConfirmDelete(null);
      if (openLogs === app.name) {
        logGenRef.current++;
        setOpenLogs(null);
        openLogsRef.current = null;
      }
    } catch (err) {
      setError(errMessage(err, "Could not delete."));
    } finally {
      setBusy(null);
    }
  }

  async function toggleLogs(name: string) {
    // Bumped BEFORE the close returns as well, so a request issued for the row
    // being closed cannot populate the pane a later row opens.
    const gen = ++logGenRef.current;
    if (openLogs === name) {
      setOpenLogs(null);
      openLogsRef.current = null;
      return;
    }
    setOpenLogs(name);
    openLogsRef.current = name;
    setLogLines(null);
    setLogError(null);
    try {
      const lines = await readAppLog(name);
      if (!shouldCommit(gen, logGenRef.current, name, openLogsRef.current)) return;
      setLogLines(lines);
    } catch (err) {
      if (!shouldCommit(gen, logGenRef.current, name, openLogsRef.current)) return;
      setLogError(errMessage(err, "Could not read the log."));
    }
  }

  // Local Escape only dismisses our own overlay; App-level Escape (goHome)
  // closes the tab itself.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && confirmDelete) {
        e.stopPropagation();
        setConfirmDelete(null);
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [confirmDelete]);

  const setFilter = (filter: AppFilter, on: boolean) => {
    setFilters((prev) => ({ ...prev, [filter]: on }));
    setAppFilter(filter, on);
  };
  const sorted = sortApps(apps);
  const selfUserId = sessionContext?.userId ?? null;
  const shown = filterApps(
    sorted.filter((app) => (app.archivedAt !== undefined) === showArchived),
    showArchived ? { ...filters, hideStopped: false } : filters,
    selfUserId,
  );

  return {
    showArchived,
    setShowArchived,
    act,
    appsLoaded,
    busy,
    confirmDelete,
    doDelete,
    error,
    filters,
    isMobile,
    logError,
    logLines,
    openLogs,
    previewsEnabled,
    setPreviewsEnabled: (enabled: boolean) => {
      setPreviewsEnabled(enabled);
      setAppPreviews(enabled);
    },
    setConfirmDelete,
    setFilter,
    selfUserId,
    shown,
    sorted,
    toggleLogs,
  };
}
