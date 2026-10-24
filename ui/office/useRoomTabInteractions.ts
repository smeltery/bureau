import { useEffect, useRef, useState } from "react";
import { send } from "../ws.ts";
import { useDispatch } from "../store.tsx";
import { useI18n } from "../i18n.tsx";
import { saveRoomView, roomViewFailure, roomViewFailureText, type RoomViewFailure } from "./room-view.ts";
import type { RoomWire } from "../../shared/types.ts";

export function useRoomTabInteractions(rooms: RoomWire[], roomNames: string[]) {
  const { t, language } = useI18n();
  const dispatch = useDispatch();
  const [viewError, setViewError] = useState<RoomViewFailure | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [editingRoom, setEditingRoom] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ roomIdx: number; x: number; y: number } | null>(null);
  const [settingsRoomId, setSettingsRoomId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  useEffect(() => {
    if (editingRoom !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingRoom]);

  useEffect(() => {
    if (!ctxMenu) return;
    function dismiss() {
      setCtxMenu(null);
    }
    window.addEventListener("click", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [ctxMenu]);

  function startEditing(i: number) {
    setEditingRoom(i);
    setEditValue(roomNames[i] ?? t("roomsUi.defaultName", { number: (i + 1).toLocaleString(language) }));
  }

  function commitEdit() {
    if (editingRoom === null) return;
    const trimmed = editValue.trim();
    const roomId = rooms[editingRoom]?.id;
    if (trimmed && roomId && trimmed !== roomNames[editingRoom]) {
      send({ type: "rename_room", roomId, name: trimmed });
    }
    setEditingRoom(null);
  }

  function openCtxMenu(roomIdx: number, x: number, y: number) {
    setCtxMenu({ roomIdx, x, y });
  }

  function handleTouchStart(e: React.TouchEvent, i: number) {
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      openCtxMenu(i, x, y);
    }, 500);
  }

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function cancelEdit() {
    setEditingRoom(null);
  }

  function handleDragStart(e: React.DragEvent, i: number) {
    if (savingOrder) return;
    setDragFrom(i);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i));
  }

  function handleDragOver(e: React.DragEvent, i: number) {
    if (dragFrom === null || dragFrom === i) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(i);
  }

  function handleDragLeave() {
    setDragOver(null);
  }

  function handleDrop(e: React.DragEvent, dropIdx: number) {
    e.preventDefault();
    setDragOver(null);
    if (dragFrom === null || dragFrom === dropIdx) {
      setDragFrom(null);
      return;
    }

    const order = rooms.map((r) => r.id);
    const [removed] = order.splice(dragFrom, 1);
    order.splice(dropIdx, 0, removed);
    const previous = rooms.map((r) => r.id);
    dispatch({ type: "rooms_reordered", order });
    setSavingOrder(true);
    setViewError(null);
    void saveRoomView("order", order)
      .catch((error: unknown) => {
        dispatch({ type: "rooms_reordered", order: previous });
        setViewError(roomViewFailure(error));
      })
      .finally(() => setSavingOrder(false));
    setDragFrom(null);
  }

  function handleDragEnd() {
    setDragFrom(null);
    setDragOver(null);
  }

  return {
    viewError: viewError ? roomViewFailureText(viewError, t) : null,
    cancelEdit,
    cancelLongPress,
    commitEdit,
    ctxMenu,
    dragFrom,
    dragOver,
    editingRoom,
    editValue,
    handleDragEnd,
    handleDragLeave,
    handleDragOver,
    handleDragStart,
    handleDrop,
    handleTouchStart,
    inputRef,
    longPressFired,
    openCtxMenu,
    setCtxMenu,
    setEditValue,
    setSettingsRoomId,
    settingsRoomId,
    startEditing,
  };
}
