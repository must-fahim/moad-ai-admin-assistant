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
            colorPrimary: "#1c1915",
            colorLink: "#1c1915",
            borderRadius: 10,
            fontFamily: "inherit",
          },
        }}
      >
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            style: { background: "#1c1915", color: "#f6f1e8", borderRadius: 12 },
          }}
        />
      </ConfigProvider>
    </AntdRegistry>
  );
}
