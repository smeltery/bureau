import { TaskDetailPanel } from "./TaskDetailPanel.tsx";
import { TaskViewHeader } from "./TaskViewHeader.tsx";
import { TaskTable } from "./TaskTable.tsx";
import { useTaskViewController } from "./useTaskViewController.tsx";

export function TaskView({ username, onClose, onFocusAgent }: { username: string; onClose: () => void; onFocusAgent?: (agentId: string) => void }) {
  const {
    agents,
    cellPad,
    closeRef,
    creating,
    filterAssignee,
    filtered,
    filterStatus,
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
  } = useTaskViewController({ onClose, onFocusAgent });

  return (
    <div
      style={{
        height: isMobile ? "100dvh" : "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
      }}
    >
      <TaskViewHeader
        isMobile={isMobile}
        shownCount={filtered.length}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        roomScope={roomScope}
        setRoomScope={setRoomScope}
        rooms={rooms}
        filterAssignee={filterAssignee}
        setFilterAssignee={setFilterAssignee}
        selectStyle={selectStyle}
        onClose={onClose}
        onCreate={() => {
          setCreating(true);
          setSelectedId(null);
        }}
      />

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Table area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Search bar */}
          <div style={{ display: "flex", gap: 8, padding: isMobile ? "10px 12px" : "10px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Search tasks..."
              style={{
                flex: 1,
                padding: "9px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-input)",
                color: "var(--text-primary)",
                fontSize: 13,
                outline: "none",
              }}
            />
            {roomScope === "all" && (
              <select
                value={allRoomsCreateRoomId}
                onChange={(event) => setAllRoomsCreateRoomId(event.target.value)}
                title="New tasks are filed here while viewing all rooms"
                style={{ ...selectStyle, flexShrink: 0, maxWidth: isMobile ? 130 : 170 }}
              >
                <option value="">Office-wide</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Table */}
          <div
            onClick={(e) => {
              // Click on empty table area (not on a row) dismisses the panel
              if (panelOpen && e.target === e.currentTarget) tryClosePanel();
            }}
            style={{ flex: 1, overflowY: "auto", overflowX: isMobile ? "hidden" : "auto" }}
          >
            <TaskTable
              tasks={filtered}
              tasksLoaded={tasksLoaded}
              selectedId={selectedId}
              isMobile={isMobile}
              cellPad={cellPad}
              thStyle={thStyle}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
              onSelect={(task) => handleSelectTask(task.id)}
              renderName={renderName}
              roomNameById={roomNameById}
            />
          </div>
        </div>

        {/* Detail panel */}
        {!isMobile &&
          (creating ? (
            <TaskDetailPanel
              closeRef={closeRef}
              mode="create"
              onClose={() => setCreating(false)}
              username={username}
              agents={agents}
              rooms={rooms}
              defaultRoomId={createRoomId}
              createRoomLocked={roomScope !== "all"}
            />
          ) : selectedTask ? (
            <TaskDetailPanel closeRef={closeRef} task={selectedTask} onClose={() => setSelectedId(null)} username={username} agents={agents} rooms={rooms} />
          ) : null)}
      </div>

      {/* Mobile detail panel as full-page */}
      {isMobile &&
        (creating ? (
          <TaskDetailPanel
            closeRef={closeRef}
            mode="create"
            onClose={() => setCreating(false)}
            username={username}
            agents={agents}
            rooms={rooms}
            defaultRoomId={createRoomId}
            createRoomLocked={roomScope !== "all"}
            fullScreen
          />
        ) : selectedTask ? (
          <TaskDetailPanel closeRef={closeRef} task={selectedTask} onClose={() => setSelectedId(null)} username={username} agents={agents} rooms={rooms} fullScreen />
        ) : null)}
    </div>
  );
}
