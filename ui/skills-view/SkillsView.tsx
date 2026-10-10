import { useEffect, useRef, useState } from "react";
import type { LibrarySkill, SkillDocument, SkillLibrary } from "../../shared/skills/library.ts";
import { useAppState } from "../store.tsx";
import { useI18n } from "../i18n.tsx";

async function request<T>(agentId: string, id?: string, method = "GET", body?: unknown): Promise<T> {
  const query = new URLSearchParams({ agentId });
  if (id) query.set("id", id);
  const response = await fetch(`/api/skills?${query}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
export function SkillsView({ onClose }: { onClose: () => void }) {
  const { agents, sessionContext } = useAppState();
  const { t } = useI18n();
  const available = agents.filter((agent) => agent.agentType !== "opencode" && (sessionContext?.role === "owner" || agent.userId === sessionContext?.userId));
  const [agentId, setAgentId] = useState(available[0]?.id ?? "");
  const [library, setLibrary] = useState<SkillLibrary | null>(null);
  const [selected, setSelected] = useState<LibrarySkill | null>(null);
  const [document, setDocument] = useState<SkillDocument | null>(null);
  const [content, setContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [rootId, setRootId] = useState("");
  const [search, setSearch] = useState("");
  const [commands, setCommands] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const dirty = creating ? content.length > 0 || name.length > 0 : document !== null && content !== document.content;
  const discard = () => !dirty || window.confirm(t("skills.discard"));
  const reset = () => {
    setSelected(null);
    setDocument(null);
    setContent("");
    setCreating(false);
    setName("");
  };
  async function load() {
    const current = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const next = await request<SkillLibrary>(agentId);
      if (current === generation.current) {
        setLibrary(next);
        setRootId(next.roots.find((root) => root.writable)?.id ?? "");
      }
    } catch (err) {
      if (current === generation.current) setError(String(err));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setLibrary(null);
    reset();
    if (agentId) void load();
    return () => {
      generation.current++;
    };
  }, [agentId]);
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" || (dirty && !["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement)?.tagName))) {
        event.stopImmediatePropagation();
        if (event.key === "Escape" && discard()) onClose();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("keydown", keydown, true);
    };
  }, [dirty, onClose, t]);
  async function select(skill: LibrarySkill) {
    if (!discard()) return;
    reset();
    setBusy(true);
    setError(null);
    const current = ++generation.current;
    try {
      const next = await request<SkillDocument>(agentId, skill.id);
      if (current === generation.current) {
        setSelected(skill);
        setDocument(next);
        setContent(next.content);
      }
    } catch (err) {
      if (current === generation.current) setError(String(err));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function save(remove = false) {
    if (remove && !window.confirm(t("skills.confirmDelete"))) return;
    setBusy(true);
    setError(null);
    try {
      await request(agentId, selected?.id, remove ? "DELETE" : creating ? "POST" : "PUT", creating ? { rootId, name, content } : { content, version: document?.version });
      reset();
      await load();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }
  return (
    <main style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg-base)", color: "var(--text-primary)", padding: 16, boxSizing: "border-box", gap: 12 }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={() => {
            if (discard()) onClose();
          }}
        >
          {t("common.back")}
        </button>
        <h2 style={{ margin: 0 }}>{t("skills.title")}</h2>
        <label>
          {t("skills.agent")}{" "}
          <select
            aria-label={t("skills.agent")}
            value={agentId}
            disabled={busy}
            onChange={(event) => {
              if (discard()) setAgentId(event.target.value);
            }}
          >
            <option value="">—</option>
            {available.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !agentId}
          onClick={() => {
            if (discard()) {
              reset();
              void load();
            }
          }}
        >
          {t("skills.reload")}
        </button>
      </header>
      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("skills.ownership")}</p>
      <nav style={{ display: "flex", gap: 8 }}>
        <button
          aria-pressed={!commands}
          onClick={() => {
            if (discard()) {
              reset();
              setCommands(false);
            }
          }}
        >
          {t("skills.title")}
        </button>
        <button
          aria-pressed={commands}
          onClick={() => {
            if (discard()) {
              reset();
              setCommands(true);
            }
          }}
        >
          {t("skills.commands")}
        </button>
      </nav>
      {error && (
        <p role="alert" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
      {busy && <span role="status">{t("skills.loading")}</span>}
      {!agentId ? (
        <p>{t("skills.selectAgent")}</p>
      ) : commands ? (
        <div style={{ overflow: "auto" }}>
          {library?.commands.map((command) => (
            <p key={command.name}>
              <strong>/{command.name}</strong> {command.aliases.map((alias) => `/${alias}`).join(", ")} — {command.description}
            </p>
          ))}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <input aria-label={t("skills.search")} placeholder={t("skills.search")} value={search} onChange={(event) => setSearch(event.target.value)} />
            <button
              disabled={busy || !library?.roots.some((root) => root.writable)}
              onClick={() => {
                if (discard()) {
                  reset();
                  setCreating(true);
                }
              }}
            >
              {t("skills.new")}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, minHeight: 0, overflow: "auto", flex: 1 }}>
            <aside style={{ flex: "1 1 220px", overflow: "auto" }}>
              {library?.skills
                .filter((skill) => `${skill.name} ${skill.description ?? ""} ${skill.aliases.join(" ")}`.toLowerCase().includes(search.toLowerCase()))
                .map((skill) => (
                  <button
                    key={skill.id}
                    disabled={busy}
                    onClick={() => void select(skill)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: 10,
                      marginBottom: 4,
                      border: selected?.id === skill.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                    }}
                  >
                    <strong>{skill.name}</strong>
                    <small style={{ display: "block" }}>
                      {library.roots.find((root) => root.id === skill.rootId)?.label}
                      {!skill.writable && ` · ${t("skills.readonly")}`}
                    </small>
                    <span>{skill.description}</span>
                  </button>
                ))}
              {library?.skills.length === 0 && <p>{t("skills.empty")}</p>}
            </aside>
            {(selected || creating) && (
              <section style={{ flex: "3 1 320px", display: "flex", flexDirection: "column", gap: 8, minHeight: 320 }}>
                {creating ? (
                  <>
                    <label>
                      {t("skills.name")} <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} disabled={busy} />
                    </label>
                    <label>
                      {t("skills.directory")}{" "}
                      <select value={rootId} onChange={(event) => setRootId(event.target.value)} disabled={busy}>
                        {library?.roots
                          .filter((root) => root.writable)
                          .map((root) => (
                            <option key={root.id} value={root.id}>
                              {root.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  </>
                ) : (
                  <strong>
                    {selected?.name}
                    {selected?.aliases.length ? ` (${selected.aliases.join(", ")})` : ""}
                  </strong>
                )}
                <textarea
                  aria-label={t("skills.content")}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  readOnly={busy || (!creating && !selected?.writable)}
                  spellCheck={false}
                  style={{ flex: 1, minHeight: 240, resize: "vertical", fontFamily: "monospace", background: "var(--bg-base)", color: "var(--text-primary)" }}
                />
                {(creating || selected?.writable) && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button disabled={busy || (!creating && !dirty) || (creating && !name)} onClick={() => void save()}>
                      {t(creating ? "common.create" : "common.save")}
                    </button>
                    {selected && (
                      <button disabled={busy} onClick={() => void save(true)}>
                        {t("common.delete")}
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </main>
  );
}
