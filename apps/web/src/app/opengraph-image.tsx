import { ImageResponse } from "next/og";

export const alt = "Norinote: a daily shortlist of jobs you are likely to get";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(135deg, #0f2a21, #1d4a39)", color: "#eafff4" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 22, height: 22, borderRadius: 11, background: "linear-gradient(135deg, #6ef0b3, #ffb347)" }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Norinote</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 88, lineHeight: 1, fontWeight: 600, letterSpacing: -3, maxWidth: 980 }}>A daily shortlist of jobs you are likely to get.</div>
          <div style={{ fontSize: 32, color: "rgba(234,255,244,0.72)", maxWidth: 900 }}>Career graph. Tailored resumes with provenance. Nothing is sent until you click.</div>
        </div>
      </div>
    ),
    size,
  );
}
