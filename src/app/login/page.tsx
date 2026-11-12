"use client";

import { useEffect, useState } from "react";
import { Button, Form, Input } from "antd";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [setup, setSetup] = useState("");

  useEffect(() => {
    fetch("/api/health").then(async (response) => {
      const body = await response.json();
      if (!body.supabase) {
        setSetup("Supabase is not configured yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, run supabase/schema.sql, then npm run seed.");
      }
    });
  }, []);

  async function submit(values: { username: string; password: string }) {
    setLoading(true);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const body = await response.json();
    setLoading(false);
    if (!response.ok) {
      toast.error(body.error || "Could not sign in.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="login">
      <section className="login-story">
        <p className="mark">MOAD</p>
        <div>
          <h1>Admin assistant</h1>
          <p>Ask for a campaign, a cargo partner, or a settlement. Every change waits for an explicit confirmation.</p>
        </div>
        <p className="fine">Synthetic data only. This assistant does not connect to the MOAD production database.</p>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <h2>Sign in</h2>
          <p className="lede">MOAD Admin. There is no public registration.</p>
          {setup ? <div className="setup-note">{setup}</div> : null}
          <Form layout="vertical" requiredMark={false} onFinish={submit}>
            <Form.Item name="username" label="Username" rules={[{ required: true, message: "Enter your username." }]}>
              <Input autoComplete="username" size="large" />
            </Form.Item>
            <Form.Item name="password" label="Password" rules={[{ required: true, message: "Enter your password." }]}>
              <Input.Password autoComplete="current-password" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>Sign in</Button>
          </Form>
        </div>
      </section>
    </main>
  );
}
