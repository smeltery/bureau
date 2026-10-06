import { useState } from "react";
import { useAppState } from "../store.tsx";
import { saveRoomView } from "./room-view.ts";

export function TuckedRooms() {
  const { rooms, allRooms } = useAppState();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tucked = allRooms.filter((room) => !rooms.some((shown) => shown.id === room.id));
  if (!tucked.length) return null;
  return (
    <>
      <select
        aria-label={`Show tucked room (${tucked.length})`}
        value=""
        disabled={saving}
        style={{ background: "var(--bg-overlay)", color: "var(--text-primary)", maxWidth: 180 }}
        onChange={(event) => {
          const id = event.target.value;
          if (!id) return;
          setSaving(true);
          setError(null);
          void saveRoomView("shown", [...rooms.map((room) => room.id), id])
            .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not show room"))
            .finally(() => setSaving(false));
        }}
      >
        <option value="">+{tucked.length} tucked</option>
        {tucked.map((room) => (
          <option key={room.id} value={room.id}>
            {room.name}
          </option>
        ))}
      </select>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
