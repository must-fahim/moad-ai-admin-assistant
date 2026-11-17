"use client";

import { useState } from "react";
import { Button, Drawer } from "antd";
import toast from "react-hot-toast";
import { SkeletonCards } from "@/components/loader";

type AuditEvent = {
  id: string;
  event: string;
  summary: string;
  createdAt: string;
  adminName: string;
};

export function ActivityButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);

  async function openActivity() {
    setOpen(true);
    setLoading(true);
    try {
      const response = await fetch("/api/audit");
      const body = await response.json();
      if (!response.ok) {
        toast.error(body.error || "Could not load the audit log.");
        return;
      }
      setEvents(body.events);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={openActivity}>Activity</Button>
      <Drawer title="Audit log" open={open} onClose={() => setOpen(false)} size={460}>
        {loading ? <SkeletonCards count={4} /> : (
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
