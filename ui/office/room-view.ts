export async function saveRoomView(kind: "order" | "shown", ids: string[]): Promise<void> {
  const response = await fetch(`/api/me/view/${kind}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [kind]: ids }),
  });
  if (!response.ok) throw new Error(`Could not save room preferences (${response.status})`);
}
