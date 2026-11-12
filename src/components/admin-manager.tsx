"use client";

import { useEffect, useState } from "react";
import { Button, Drawer, Form, Input, Modal, Select, Switch, Table, Tag } from "antd";
import toast from "react-hot-toast";
import { Skeleton } from "@/components/loader";
import { COUNTRIES } from "@/lib/countries";

type AdminRow = {
  id: string;
  name: string;
  phone: string | null;
  country: string | null;
  username: string;
  is_active: boolean;
  is_primary: boolean;
};

export function AdminManager({ open, onClose, currentId }: { open: boolean; onClose: () => void; currentId: string }) {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setLoading(true);
    }, 0);
    void fetch("/api/admins").then(async (response) => {
      const body = await response.json();
      if (cancelled) return;
      setLoading(false);
      if (!response.ok) {
        toast.error(body.error || "Could not load admins.");
        return;
      }
      setAdmins(body.admins);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open]);

  async function createAdmin(values: { name: string; phone: string; country: string; username: string; password: string }) {
    setCreating(true);
    const response = await fetch("/api/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const body = await response.json();
    setCreating(false);
    if (!response.ok) {
      toast.error(body.error || "Could not add the admin.");
      return;
    }
    toast.success("Admin added.");
    form.resetFields();
    setAdmins((current) => [...current, body.admin]);
    Modal.destroyAll();
    setModalOpen(false);
  }

  const [modalOpen, setModalOpen] = useState(false);

  async function toggle(admin: AdminRow, isActive: boolean) {
    const response = await fetch(`/api/admins/${admin.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    const body = await response.json();
    if (!response.ok) {
      toast.error(body.error || "Could not update the admin.");
      return;
    }
    toast.success(isActive ? "Admin activated." : "Admin deactivated.");
    setAdmins((current) => current.map((item) => (item.id === admin.id ? body.admin : item)));
  }

  return (
    <Drawer title="Administrators" open={open} onClose={onClose} size={760} extra={<Button type="primary" onClick={() => setModalOpen(true)}>Add admin</Button>}>
      {loading && admins.length === 0 ? <Skeleton rows={7} /> : null}
      <Table
        rowKey="id"
        loading={loading && admins.length > 0}
        pagination={false}
        dataSource={admins}
        style={loading && admins.length === 0 ? { display: "none" } : undefined}
        columns={[
          { title: "Name", dataIndex: "name", render: (name: string, admin: AdminRow) => <>{name} {admin.is_primary ? <Tag>Primary</Tag> : null}</> },
          { title: "Phone", dataIndex: "phone", render: (value: string | null) => value || "—" },
          { title: "Country", dataIndex: "country", render: (value: string | null) => value || "—" },
          { title: "Username", dataIndex: "username" },
          {
            title: "Active",
            dataIndex: "is_active",
            render: (active: boolean, admin: AdminRow) => (
              <Switch
                checked={active}
                disabled={admin.id === currentId || admin.is_primary}
                onChange={(checked) => toggle(admin, checked)}
              />
            ),
          },
        ]}
      />
      <Modal title="Add admin" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={createAdmin} requiredMark={false}>
          <Form.Item name="name" label="Name" rules={[{ required: true, min: 2, message: "Enter the name." }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Phone number" rules={[{ required: true, min: 6, message: "Enter a phone number." }]}>
            <Input />
          </Form.Item>
          <Form.Item name="country" label="Country" rules={[{ required: true, message: "Choose a country." }]}>
            <Select showSearch options={COUNTRIES.map((country) => ({ value: country, label: country }))} />
          </Form.Item>
          <p style={{ margin: "8px 0 12px", color: "#6d655c" }}>Credentials</p>
          <Form.Item name="username" label="Username" rules={[{ required: true, min: 3, message: "Enter a username." }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 8, message: "Use at least 8 characters." }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={creating} block>Create admin</Button>
        </Form>
      </Modal>
    </Drawer>
  );
}
