import { useState } from "react";

/** HTML drop zone positioned over an SVG door — SVG elements are unreliable drag-and-drop targets */
export function DoorDropZone({
  side,
  onDrop,
  onDragOverChange,
  onClick,
}: {
  side: "left" | "right";
  onDrop: (deskIndex: number) => boolean;
  onDragOverChange: (over: boolean) => void;
  onClick: () => void;
}) {
  const [reject, setReject] = useState(false);
  // Pixel positions within the 950×700 scene container, derived from the SVG door transforms
  const style: React.CSSProperties =
    side === "left" ? { position: "absolute", left: 0, top: 225, width: 85, height: 155, zIndex: 200 } : { position: "absolute", right: 0, top: 225, width: 85, height: 155, zIndex: 200 };
  return (
    <div
      data-no-pan
      style={{ ...style, cursor: "pointer", background: reject ? "rgba(255,60,60,0.08)" : "transparent" }}
      onClick={onClick}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={() => onDragOverChange(true)}
      onDragLeave={() => onDragOverChange(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDragOverChange(false);
        const src = parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (!isNaN(src)) {
          const ok = onDrop(src);
          if (!ok) {
            setReject(true);
            setTimeout(() => setReject(false), 400);
          }
        }
      }}
    />
  );
}
