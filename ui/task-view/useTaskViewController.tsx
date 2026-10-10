import type { TaskStatus } from "../../shared/tasks.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { shouldHostCloseOnEscape } from "../components/modals/expandedEditorState.ts";
import { useAppState } from "../store.tsx";
import { type SortDir, type SortField } from "./constants.ts";
import { filterAndSortTasks, TASK_PRIORITIES, taskFilterCounts, type TaskPriorityFilter, type TaskRoomScope } from "./taskFilters.ts";

export function useTaskViewController({
  onClose,
  onFocusAgent,
  openTaskId,
}: {
  onClose: () => void;
  onFocusAgent?: (agentId: string) => void;
  /** When set (e.g. from a chat task chip), select that task once tasks are loaded. */
  openTaskId?: string | null;
}) {
  const { tasks, tasksLoaded, agents, isMobile, rooms, currentRoom } = useAppState();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<TaskStatus[]>(["open", "in_progress"]);
  const [filterPriorities, setFilterPriorities] = useState<TaskPriorityFilter[]>(TASK_PRIORITIES);
  const [roomScope, setRoomScope] = useState<TaskRoomScope>(() => (rooms[currentRoom]?.id ? rooms[currentRoom]!.id : "all"));
  const [allRoomsCreateRoomId, setAllRoomsCreateRoomId] = useState(() => (rooms[currentRoom]?.id ? rooms[currentRoom]!.id : ""));
  const [creating, setCreating] = useState(false);
  const [filterAssignee, setFilterAssignee] = useState("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const pendingSelectRef = useRef<string | null>(null);

  const selectedTask = selectedId ? tasks.find((t) => t.id === selectedId) : null;
  const panelOpen = !!(selectedTask || creating);

  function tryClosePanel() {
    if (closeRef.current) {
      closeRef.current();
    }
  }

  useEffect(() => {
    if (!panelOpen && pendingSelectRef.current) {
      const id = pendingSelectRef.current;
      pendingSelectRef.current = null;
      setSelectedId(id);
    }
  }, [panelOpen]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!openTaskId || !tasksLoaded) return;
    if (!tasks.some((task) => task.id === openTaskId)) return;
    setCreating(false);
    setSelectedId(openTaskId);
  }, [openTaskId, tasks, tasksLoaded]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!shouldHostCloseOnEscape(e)) return;
      e.stopPropagation();
      if (panelOpen) {
        tryClosePanel();
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose, panelOpen]);

  const agentsByName = useMemo(() => {
    const map = new Map<string, string>(); // lowercase name -> agentId
    for (const a of agents) map.set(a.name.toLowerCase(), a.id);
    return map;
  }, [agents]);

  const filtered = useMemo(() => {
    return filterAndSortTasks(tasks, roomScope, filterStatus, search, filterAssignee, sortField, sortDir, filterPriorities);
  }, [tasks, roomScope, filterStatus, search, filterAssignee, sortField, sortDir, filterPriorities]);

  const filterCounts = useMemo(
    () => taskFilterCounts(tasks, roomScope, filterStatus, filterPriorities, search, filterAssignee),
    [tasks, roomScope, filterStatus, filterPriorities, search, filterAssignee],
  );

  function renderName(name: string | undefined) {
    if (!name) return "";
    const agentId = agentsByName.get(name.toLowerCase());
    if (agentId && onFocusAgent) {
      return (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onFocusAgent(agentId);
          }}
          style={{ cursor: "pointer", color: "var(--accent)", textDecoration: "none" }}
          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
        >
          {name}
        </span>
      );
    }
    return name;
  }

  function roomNameById(roomId: string | undefined) {
    if (!roomId) return "Office-wide";
    return rooms.find((room) => room.id === roomId)?.name ?? "Unknown room";
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function handleSelectTask(taskId: string) {
    if (taskId === selectedId) {
      tryClosePanel();
      return;
    }
    if (panelOpen) {
      tryClosePanel();
      pendingSelectRef.current = taskId;
      return;
    }
    setSelectedId(taskId);
    setCreating(false);
  }

  const cellPad = isMobile ? "6px 4px" : "8px 10px";

  const thStyle: React.CSSProperties = {
    padding: cellPad,
    fontSize: 10,
    fontWeight: 700,
    color: "var(--text-muted)",
    fontFamily: "'JetBrains Mono',monospace",
    letterSpacing: "0.05em",
    textAlign: "left",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    borderBottom: "1px solid var(--border-subtle)",
  };

  const selectStyle: React.CSSProperties = {
    padding: "7px 12px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-input)",
    color: "var(--text-primary)",
    fontSize: 12,
    minHeight: 36,
    outline: "none",
  };

  const createRoomId = roomScope === "all" ? allRoomsCreateRoomId : roomScope === "global" ? "" : roomScope;

  return {
    agents,
    cellPad,
    closeRef,
    creating,
    filterAssignee,
    filtered,
    filterStatus,
    filterPriorities,
    setFilterPriorities,
    filterCounts,
    handleSelectTask,
    handleSort,
    inputRef,
    isMobile,
    panelOpen,
    renderName,
    roomNameById,
    rooms,
    roomScope,
    setRoomScope,
    createRoomId,
    allRoomsCreateRoomId,
    setAllRoomsCreateRoomId,
    search,
    selectStyle,
    selectedId,
    selectedTask,
    setCreating,
    setFilterAssignee,
    setFilterStatus,
    setSearch,
    setSelectedId,
    sortDir,
    sortField,
    tasksLoaded,
    thStyle,
    tryClosePanel,
  };
}
