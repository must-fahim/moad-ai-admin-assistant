"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DatabaseOutlined, LogoutOutlined, MenuOutlined, MessageOutlined, PlusOutlined, ReadOutlined, TeamOutlined } from "@ant-design/icons";
import { AdminManager } from "@/components/admin-manager";
import type { AdminProfile } from "@/lib/chat-types";

const PROMPTS = [
  "How many campaigns are in progress?",
  "How many advertisers are approved?",
  "Find cargo partners named Minho Park",
  "Stop the Harbor Night campaign",
  "Summarize cargo settlements for 2026-11",
];

const NAV = [
  { href: "/", label: "Assistant", icon: <MessageOutlined /> },
  { href: "/guide", label: "Question guide", icon: <ReadOutlined /> },
  { href: "/tables", label: "Database tables", icon: <DatabaseOutlined /> },
];

type ShellActions = {
  onNewChat?: () => void;
  onPrompt?: (prompt: string) => void;
};

const ShellActionsContext = createContext<(actions: ShellActions) => void>(() => {});

export function useShellActions(actions: ShellActions) {
  const setActions = useContext(ShellActionsContext);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    setActions({
      onNewChat: () => actionsRef.current.onNewChat?.(),
      onPrompt: (prompt) => actionsRef.current.onPrompt?.(prompt),
    });
    return () => setActions({});
  }, [setActions]);
}

export function AppShell({
  admin,
  children,
}: {
  admin: AdminProfile;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [adminsOpen, setAdminsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const actionsRef = useRef<ShellActions>({});
  const setActions = useCallback((actions: ShellActions) => {
    actionsRef.current = actions;
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  async function newChat() {
    setNavOpen(false);
    if (pathname === "/" && actionsRef.current.onNewChat) {
      actionsRef.current.onNewChat();
      return;
    }
    await fetch("/api/chat", { method: "DELETE" });
    router.push("/");
  }

  function ask(prompt: string) {
    setNavOpen(false);
    if (pathname === "/" && actionsRef.current.onPrompt) {
      actionsRef.current.onPrompt(prompt);
      return;
    }
    router.push(`/?prompt=${encodeURIComponent(prompt)}`);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="shell">
      {navOpen ? <button className="nav-scrim" type="button" aria-label="Close menu" onClick={() => setNavOpen(false)} /> : null}
      <aside className={`sidebar${navOpen ? " open" : ""}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">M</span>
          <div>
            <p className="mark">MOAD</p>
            <strong>Admin assistant</strong>
          </div>
          <button className="sidebar-close" type="button" onClick={() => setNavOpen(false)} aria-label="Close menu">Close</button>
        </div>
        <button className="new-chat" onClick={newChat} type="button"><PlusOutlined /> New chat</button>
        <nav className="side-nav" aria-label="Pages">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link key={item.href} className={active ? "active" : ""} href={item.href} aria-current={active ? "page" : undefined}>
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
        <p className="side-label">Try asking</p>
        <div className="prompt-list">
          {PROMPTS.map((prompt) => (
            <button key={prompt} type="button" onClick={() => ask(prompt)}>{prompt}</button>
          ))}
        </div>
        <div className="sidebar-foot">
          <div className="who">
            <span className="avatar" aria-hidden="true">{initials(admin.name)}</span>
            <div>
              <strong>{admin.name}</strong>
              <span>{admin.username}</span>
            </div>
          </div>
          <div className="foot-actions">
            <button type="button" onClick={() => { setNavOpen(false); setAdminsOpen(true); }}><TeamOutlined /> Admins</button>
            <button type="button" onClick={logout}><LogoutOutlined /> Log out</button>
          </div>
        </div>
      </aside>
      <div className="shell-main">
        <div className="mobile-bar">
          <button type="button" onClick={() => setNavOpen(true)} aria-label="Open menu"><MenuOutlined /> Menu</button>
          <strong>MOAD</strong>
        </div>
        <ShellActionsContext.Provider value={setActions}>{children}</ShellActionsContext.Provider>
      </div>
      <AdminManager open={adminsOpen} onClose={() => setAdminsOpen(false)} currentId={admin.id} />
    </div>
  );
}

function initials(name: string) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return letters || "A";
}
