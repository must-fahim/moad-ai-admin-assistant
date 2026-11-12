"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Drawer } from "antd";
import toast from "react-hot-toast";
import Link from "next/link";
import { useShellActions } from "@/components/app-shell";
import { Loader, SkeletonCards } from "@/components/loader";
import type { ChatMessage, ChatPayload } from "@/lib/chat-types";

const STARTERS = [
  { label: "Count", text: "How many campaigns are in progress?" },
  { label: "Search", text: "Find cargo partners named Minho Park" },
  { label: "Settlement", text: "Summarize cargo settlements for 2026-11" },
  { label: "Advertisers", text: "How many advertisers are approved?" },
];

export function ChatScreen({ initialDraft = "" }: { initialDraft?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [draft, setDraft] = useState(initialDraft);

  useEffect(() => {
    if (initialDraft) setDraft(initialDraft);
  }, [initialDraft]);
  const [busy, setBusy] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [events, setEvents] = useState<{ id: string; event: string; summary: string; createdAt: string; adminName: string }[]>([]);
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat")
      .then(async (response) => {
        const body = await response.json();
        if (!cancelled && response.ok) setMessages(body.messages);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const node = transcript.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  async function send(text: string, resume?: ChatPayload["resume"] & { id?: string }) {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setBusy(true);
    const pendingId = `pending-${Date.now()}`;
    const pending: ChatMessage = {
      id: pendingId,
      role: "user",
      content: message,
      payload: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, pending]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, resume }),
      });
      const body = await response.json();
      if (!response.ok || !body.assistantMessage) {
        const explanation = body.error || "The assistant could not answer. Try a count, a name, or one record to change.";
        toast.error(explanation);
        setMessages((current) => [
          ...current.filter((item) => item.id !== pendingId),
          body.userMessage ?? pending,
          {
            id: `${pendingId}-error`,
            role: "assistant",
            content: explanation,
            payload: null,
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }
      setMessages((current) => mergeClosed(current.filter((item) => item.id !== pendingId), body.closedMessages, [body.userMessage, body.assistantMessage]));
    } catch {
      const explanation = "The assistant could not be reached.";
      toast.error(explanation);
      setMessages((current) => [
        ...current.filter((item) => item.id !== pendingId),
        pending,
        {
          id: `${pendingId}-error`,
          role: "assistant",
          content: explanation,
          payload: null,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
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

  async function openActivity() {
    setActivityOpen(true);
    setActivityLoading(true);
    try {
      const response = await fetch("/api/audit");
      const body = await response.json();
      if (!response.ok) {
        toast.error(body.error || "Could not load the audit log.");
        return;
      }
      setEvents(body.events);
    } finally {
      setActivityLoading(false);
    }
  }

  useShellActions({ onNewChat: clearChat, onPrompt: send });

  return (
    <>
      <section className="stage">
        <header className="stage-bar">
          <div className="stage-title">
            <strong>Assistant</strong>
            <span>Ask in plain language. A change waits until you confirm one record.</span>
          </div>
          <div className="stage-actions">
            <Button onClick={openActivity}>Activity</Button>
          </div>
        </header>
        <div className="transcript" ref={transcript} aria-busy={historyLoading || busy}>
          <div className="thread">
            {historyLoading ? <HistorySkeleton /> : null}
            {!historyLoading && messages.length === 0 ? (
              <div className="empty">
                <p className="eyebrow">MOAD assistant</p>
                <h2>What needs doing?</h2>
                <p>Ask for a count, a name, or a change. Shared names come back as a list, and nothing is written until you confirm. The <Link href="/guide">question guide</Link> lists every approved function.</p>
                <div className="starters">
                  {STARTERS.map((starter) => (
                    <button key={starter.text} type="button" onClick={() => send(starter.text)}>
                      <span>{starter.label}</span>
                      {starter.text}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message) => (
              <article key={message.id} className={`bubble ${message.role}`}>
                {message.role === "assistant" ? <span className="bubble-avatar" aria-hidden="true">M</span> : null}
                <div className="bubble-stack">
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
                  <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                </div>
              </article>
            ))}
            {busy ? (
              <article className="bubble assistant">
                <span className="bubble-avatar" aria-hidden="true">M</span>
                <div className="bubble-body"><Loader pulse label="Checking the records" /></div>
              </article>
            ) : null}
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
          <p className="composer-hint">Enter to send. Shift+Enter for a new line.</p>
        </div>
      </section>
      <Drawer title="Audit log" open={activityOpen} onClose={() => setActivityOpen(false)} size={460}>
        {activityLoading ? <SkeletonCards count={4} /> : (
          <div className="audit-list">
            {events.length === 0 ? <p className="audit-empty">No confirm, cancel, or refusal has been recorded yet.</p> : null}
            {events.map((event) => (
              <article key={event.id} className="audit-item">
                <strong>{event.event}</strong>
                <div>{event.adminName} · {new Date(event.createdAt).toLocaleString()}</div>
                <p>{event.summary}</p>
              </article>
            ))}
          </div>
        )}
      </Drawer>
    </>
  );
}

function HistorySkeleton() {
  return (
    <div className="history-skeleton" aria-hidden="true">
      <div className="sk-bubble left"><span /><span /></div>
      <div className="sk-bubble right"><span /></div>
      <div className="sk-bubble left"><span /><span /><span /></div>
    </div>
  );
}

function mergeClosed(current: ChatMessage[], closed: ChatMessage[] | undefined, added: ChatMessage[]) {
  const replacements = new Map((closed ?? []).map((message) => [message.id, message]));
  return [...current.map((message) => replacements.get(message.id) ?? message), ...added];
}

function confirmationLabel(state: NonNullable<ChatPayload["confirmation"]>["state"]) {
  if (state === "expired") return "Left unanswered";
  return state;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
        <div className={`confirm-card${confirmation.state === "pending" ? "" : " is-closed"}`}>
          <strong>{confirmation.title}</strong>
          <div className="confirm-lines">
            {confirmation.lines.map((line) => (
              <div key={line.label} style={{ display: "contents" }}>
                <span>{line.label}</span>
                <b>{line.value}</b>
              </div>
            ))}
          </div>
          {confirmation.state === "pending" ? (
            <div className="confirm-actions">
              <Button type="primary" disabled={busy} onClick={() => onDecide("confirm", confirmation.pendingActionId)}>Confirm</Button>
              <Button disabled={busy} onClick={() => onDecide("cancel", confirmation.pendingActionId)}>Cancel</Button>
              <Button disabled={busy} onClick={() => onDecide("refuse", confirmation.pendingActionId)}>Refuse</Button>
            </div>
          ) : <span className={`tag ${confirmation.state}`}>{confirmationLabel(confirmation.state)}</span>}
        </div>
      ) : null}
      {!payload.matches && payload.rows && payload.rows.length > 0 && payload.columns ? (
        <div className="result-frame">
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
        </div>
      ) : null}
    </>
  );
}
