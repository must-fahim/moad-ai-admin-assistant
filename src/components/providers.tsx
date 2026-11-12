"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider } from "antd";
import { Toaster } from "react-hot-toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AntdRegistry>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: "#1d4ed8",
            colorLink: "#1d4ed8",
            borderRadius: 10,
            fontFamily: "inherit",
            controlHeight: 38,
          },
        }}
      >
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "#0f172a",
              color: "#f8fafc",
              borderRadius: 12,
              fontSize: 14,
              boxShadow: "0 12px 32px rgba(15, 23, 42, 0.18)",
            },
          }}
        />
      </ConfigProvider>
    </AntdRegistry>
  );
}
