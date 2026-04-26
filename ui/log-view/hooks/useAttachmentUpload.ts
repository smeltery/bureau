import { useRef, useState } from "react";
import type { Attachment } from "../../../shared/types.ts";

export type StagedAttachment = Attachment & { id: string; uploading: boolean; error?: string };

/**
 * Staged-attachment lifecycle for the input bar.
 *
 * Tracks files the user has picked (via click, drag-drop, or paste) while
 * they upload to the server. Caller sends `validAttachments` on message
 * submit and calls `clear()` to reset afterwards.
 *
 * `draggingOver` reflects whether a drag is over the pane (used by the
 * InputBar to highlight its border). We reference-count dragenter/leave
 * events because nested elements fire spurious leave events otherwise.
 */
export function useAttachmentUpload(agentId: string) {
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const [draggingOver, setDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

  const hasUploading = stagedAttachments.some((a) => a.uploading);
  const validAttachments = stagedAttachments.filter((a) => !a.error);

  function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) {
        const id = Math.random().toString(36).slice(2, 10);
        setStagedAttachments((prev) => [
          ...prev,
          {
            id,
            filename: "",
            originalName: file.name,
            mediaType: file.type || "application/octet-stream",
            size: file.size,
            uploading: false,
            error: "File too large (max 20MB)",
          },
        ]);
        continue;
      }
      const id = Math.random().toString(36).slice(2, 10);
      setStagedAttachments((prev) => [
        ...prev,
        {
          id,
          filename: "",
          originalName: file.name,
          mediaType: file.type || "application/octet-stream",
          size: file.size,
          uploading: true,
        },
      ]);
      const formData = new FormData();
      formData.append("file", file);
      fetch(`/api/upload/${agentId}`, { method: "POST", body: formData })
        .then((res) => {
          if (!res.ok) throw new Error(`Upload failed (${res.status})`);
          return res.json();
        })
        .then((data: { attachments: Attachment[] }) => {
          const att = data.attachments[0];
          setStagedAttachments((prev) => prev.map((s) => (s.id === id ? { ...s, ...att, uploading: false } : s)));
        })
        .catch((err) => {
          setStagedAttachments((prev) => prev.map((s) => (s.id === id ? { ...s, uploading: false, error: err.message } : s)));
        });
    }
  }

  function removeStaged(id: string) {
    setStagedAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function clear() {
    setStagedAttachments([]);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setDraggingOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDraggingOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDraggingOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      handleFileSelect(dt.files);
    }
    // If no files, let default text paste through
  }

  return {
    stagedAttachments,
    hasUploading,
    validAttachments,
    draggingOver,
    handleFileSelect,
    removeStaged,
    clear,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handlePaste,
  };
}
