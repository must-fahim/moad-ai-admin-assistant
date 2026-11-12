"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Drawer } from "antd";
import toast from "react-hot-toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminManager } from "@/components/admin-manager";
import type { AdminProfile, ChatMessage, ChatPayload } from "@/lib/chat-types";

const PROMPTS = [
  "How many campaigns are in progress?",
  "How many advertisers are approved?",
  "Find cargo partners named Minho Park",
  "Stop the Harbor Night campaign",
  "Summarize cargo settlements for 2026-11",
];

export function ChatScreen({ admin, initialDraft = "" }: { admin: AdminProfile; initialDraft?: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState(initialDraft);

  useEffect(() => {
    if (initialDraft) setDraft(initialDraft);
  }, [initialDraft]);
  const [busy, setBusy] = useState(false);
  const [adminsOpen, setAdminsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [events, setEvents] = useState<{ id: string; event: string; summary: string; createdAt: string; adminName: string }[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/chat").then(async (response) => {
      const body = await response.json();
      if (response.ok) setMessages(body.messages);
    });
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  async function send(text: string, resume?: ChatPayload["resume"] & { id?: string }) {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setBusy(true);
    setMenuOpen(false);
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, resume }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      toast.error(body.error || "The assistant could not answer.");
      return;
    }
    setMessages((current) => [...current, body.userMessage, body.assistantMessage]);
  }

  async function decide(intent: "confirm" | "cancel" | "refuse", pendingActionId: string) {
    setBusy(true);
    const response = await fetch("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent, pendingActionId }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      toast.error(body.error || "The decision could not be saved.");
      return;
    }
    if (body.message) {
      setMessages((current) => current.map((item) => (item.id === body.message.id ? body.message : item)));
    }
    toast.success(intent === "confirm" ? "Confirmed." : intent === "cancel" ? "Cancelled." : "Refused.");
  }

  async function clearChat() {
    await fetch("/api/chat", { method: "DELETE" });
    setMessages([]);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  async function openActivity() {
    setActivityOpen(true);
    const response = await fetch("/api/audit");
    const body = await response.json();
    if (!response.ok) {
      toast.error(body.error || "Could not load the audit log.");
      return;
    }
    setEvents(body.events);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <p className="mark">MOAD</p>
          <h1>Admin assistant</h1>
          <p className="quiet">Counts run immediately. A change waits until you confirm one record.</p>
        </div>
        <button className="ghost-button" onClick={clearChat} type="button">New chat</button>
        <Link className="ghost-button" href="/guide">Question guide</Link>
        <div className="prompt-list">
          {PROMPTS.map((prompt) => (
            <button key={prompt} type="button" onClick={() => send(prompt)}>{prompt}</button>
          ))}
        </div>
        <div className="sidebar-foot">
          <div className="who">{admin.name}<span>{admin.username}</span></div>
          <button className="ghost-button" type="button" onClick={() => setAdminsOpen(true)}>Administrators</button>
          <button className="ghost-button" type="button" onClick={logout}>Log out</button>
        </div>
      </aside>
      <section className="stage">
        <header className="stage-bar">
          <strong>Assistant</strong>
          <div className="stage-actions">
            <Button className="mobile-only" onClick={() => setMenuOpen(true)}>Menu</Button>
            <Button onClick={() => router.push("/guide")}>Guide</Button>
            <Button onClick={openActivity}>Activity</Button>
            <Button onClick={() => setAdminsOpen(true)}>Admins</Button>
          </div>
        </header>
        <div className="transcript">
          <div className="thread">
            {messages.length === 0 ? (
              <div className="empty">
                <h2>What needs doing?</h2>
                <p>Ask for a count, a name, or a change. Shared names come back as a list, and nothing is written until you confirm. The <Link href="/guide">question guide</Link> lists every approved function.</p>
              </div>
            ) : null}
            {messages.map((message) => (
              <article key={message.id} className={`bubble ${message.role}`}>
                <div className="bubble-body">
                  {message.content}
                  <Result payload={message.payload} busy={busy} onChoose={(match) => {
                    if (!message.payload?.resume) return;
                    send(`Use ${match.label}`, {
                      action: message.payload.resume.action,
                      args: { ...message.payload.resume.args, id: match.id },
                    });
                  }} onDecide={decide} />
                </div>
              </article>
            ))}
            {busy ? <article className="bubble assistant"><div className="bubble-body">Checking the records…</div></article> : null}
            <div ref={bottom} />
          </div>
        </div>
        <div className="composer-wrap">
          <form className="composer" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
            <textarea
              value={draft}
              placeholder="Ask about a campaign, a partner, or a settlement"
              rows={2}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(draft);
                }
              }}
            />
            <Button type="primary" htmlType="submit" loading={busy}>Send</Button>
          </form>
        </div>
      </section>
      <AdminManager open={adminsOpen} onClose={() => setAdminsOpen(false)} currentId={admin.id} />
      <Drawer title="Audit log" open={activityOpen} onClose={() => setActivityOpen(false)} width={460}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {events.length === 0 ? <p>No confirm, cancel, or refusal has been recorded yet.</p> : null}
          {events.map((event) => (
            <article key={event.id} style={{ borderBottom: "1px solid #eee8de", paddingBottom: 10 }}>
              <strong style={{ textTransform: "capitalize" }}>{event.event}</strong>
              <div style={{ color: "#6d655c", fontSize: 13 }}>{event.adminName} · {new Date(event.createdAt).toLocaleString()}</div>
              <p style={{ margin: "6px 0 0" }}>{event.summary}</p>
            </article>
          ))}
        </div>
      </Drawer>
      <Drawer title="Menu" open={menuOpen} onClose={() => setMenuOpen(false)}>
        <Link className="guide-menu-link" href="/guide" onClick={() => setMenuOpen(false)}>Question guide</Link>
        <div className="prompt-list">
          {PROMPTS.map((prompt) => (
            <button key={prompt} type="button" onClick={() => send(prompt)} style={{ color: "#1c1915", borderColor: "#e4dfd6" }}>{prompt}</button>
          ))}
        </div>
      </Drawer>
    </div>
  );
}

function Result({
  payload,
  busy,
  onChoose,
  onDecide,
}: {
  payload: ChatPayload | null;
  busy: boolean;
  onChoose: (match: { id: string; label: string; detail: string }) => void;
  onDecide: (intent: "confirm" | "cancel" | "refuse", pendingActionId: string) => void;
}) {
  if (!payload) return null;
  const confirmation = payload.confirmation;
  return (
    <>
      {payload.matches && confirmation?.state == null ? (
        <div className="match-list">
          {payload.matches.map((match) => (
            <button key={match.id} type="button" disabled={busy} onClick={() => onChoose(match)}>
              <strong>{match.label}</strong>
              <span>{match.detail}</span>
            </button>
          ))}
        </div>
      ) : null}
      {confirmation ? (
        <div className="confirm-card">
          <strong>{confirmation.title}</strong>
          <div className="confirm-lines">
            {confirmation.lines.map((line) => (
              <div key={line.label} style={{ display: "contents" }}>
                <span>{line.label}</span>
                <b style={{ color: "#1c1915", fontWeight: 560 }}>{line.value}</b>
              </div>
            ))}
          </div>
          {confirmation.state === "pending" ? (
            <div className="confirm-actions">
              <Button type="primary" disabled={busy} onClick={() => onDecide("confirm", confirmation.pendingActionId)}>Confirm</Button>
              <Button disabled={busy} onClick={() => onDecide("cancel", confirmation.pendingActionId)}>Cancel</Button>
              <Button disabled={busy} onClick={() => onDecide("refuse", confirmation.pendingActionId)}>Refuse</Button>
            </div>
          ) : <span className="tag">{confirmation.state}</span>}
        </div>
      ) : null}
      {!payload.matches && payload.rows && payload.rows.length > 0 && payload.columns ? (
        <table className="result-table">
          <thead>
            <tr>{payload.columns.map((column) => <th key={column.key}>{column.title}</th>)}</tr>
          </thead>
          <tbody>
            {payload.rows.map((row, index) => (
              <tr key={index}>{payload.columns!.map((column) => <td key={column.key}>{row[column.key]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
