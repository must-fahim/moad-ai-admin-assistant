import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(160deg, #60a5fa, #1d4ed8)",
          color: "white",
          fontSize: 108,
          fontWeight: 700,
          letterSpacing: "-0.06em",
        }}
      >
        M
      </div>
    ),
    { ...size },
  );
}
