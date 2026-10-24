import { useState } from "react";
import { useAppState } from "../store.tsx";
import { useI18n } from "../i18n.tsx";
import { saveRoomView, roomViewFailure, roomViewFailureText, type RoomViewFailure } from "./room-view.ts";

export function TuckedRooms() {
  const { t, tn, language } = useI18n();
  const { rooms, allRooms } = useAppState();
  const [error, setError] = useState<RoomViewFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const tucked = allRooms.filter((room) => !rooms.some((shown) => shown.id === room.id));
  if (!tucked.length) return null;
  return (
    <>
      <select
        aria-label={t("roomsUi.showTucked", { count: tucked.length.toLocaleString(language) })}
        value=""
        disabled={saving}
        style={{ background: "var(--bg-overlay)", color: "var(--text-primary)", maxWidth: 180 }}
        onChange={(event) => {
          const id = event.target.value;
          if (!id) return;
          setSaving(true);
          setError(null);
          void saveRoomView("shown", [...rooms.map((room) => room.id), id])
            .catch((err: unknown) => setError(roomViewFailure(err)))
            .finally(() => setSaving(false));
        }}
      >
        <option value="">{tn("roomsUi.tucked", tucked.length, { formattedCount: tucked.length.toLocaleString(language) })}</option>
        {tucked.map((room) => (
          <option key={room.id} value={room.id}>
            {room.name}
          </option>
        ))}
      </select>
      {error && <span role="alert">{roomViewFailureText(error, t)}</span>}
    </>
  );
}
