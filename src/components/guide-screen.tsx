"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { GUIDE_GROUPS, GUIDE_QUESTION_COUNT, type GuideGroup } from "@/lib/guide";
import type { AdminProfile } from "@/lib/chat-types";

export function GuideScreen({ admin }: { admin: AdminProfile }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!needle) return GUIDE_GROUPS;
    return GUIDE_GROUPS.map((group) => ({
      ...group,
      questions: group.questions.filter((item) =>
        [group.title, group.summary, item.text, item.action, item.kind].join(" ").toLowerCase().includes(needle),
      ),
    })).filter((group) => group.questions.length > 0);
  }, [needle]);

  const shown = groups.reduce((total, group) => total + group.questions.length, 0);

  return (
    <div className="guide">
      <header className="guide-bar">
        <div>
          <p className="mark">MOAD</p>
          <h1>Question guide</h1>
        </div>
        <div className="stage-actions">
          <Link className="guide-back" href="/">Back to assistant</Link>
          <span className="who guide-who">{admin.name}<span>{admin.username}</span></span>
        </div>
      </header>
      <div className="guide-body">
        <div className="guide-intro">
          <p>
            {GUIDE_QUESTION_COUNT} example questions, one for each approved function.
            A read runs immediately. A change identifies one record, then waits until you confirm.
          </p>
          <label className="guide-search">
            <span>Search questions</span>
            <input
              value={query}
              placeholder="Try settlement, Solo Pay, or Harbor Night"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <nav className="guide-jumps" aria-label="Function groups">
            {GUIDE_GROUPS.map((group) => (
              <a key={group.id} href={`#${group.id}`}>{group.title}</a>
            ))}
          </nav>
        </div>
        {groups.length === 0 ? (
          <p className="guide-empty">No question matches “{query.trim()}”.</p>
        ) : (
          <p className="guide-count">{shown} {shown === 1 ? "question" : "questions"}</p>
        )}
        {groups.map((group) => (
          <GuideSection key={group.id} group={group} />
        ))}
      </div>
    </div>
  );
}

function GuideSection({ group }: { group: GuideGroup }) {
  return (
    <section id={group.id} className="guide-section">
      <div className="guide-section-head">
        <h2>{group.title}</h2>
        <p>{group.summary}</p>
      </div>
      <ol>
        {group.questions.map((item) => (
          <li key={item.action}>
            <div>
              <span className={`guide-kind ${item.kind}`}>{item.kind === "read" ? "Read" : "Change"}</span>
              <code>{item.action}</code>
              <p>{item.text}</p>
            </div>
            <Link href={`/?prompt=${encodeURIComponent(item.text)}`}>Ask this</Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
