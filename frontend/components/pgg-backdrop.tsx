"use client";

/**
 * Decorative 3D stage: animated gradient aurora, a neon perspective grid and
 * drifting blobs. Purely visual, so it stays out of the accessibility tree.
 * Shared by the sign-in screen and the connection-profile gate.
 */
export default function PggBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="pgg-aurora" />

      <div
        className="pgg-blob"
        style={{
          width: 360,
          height: 360,
          left: "4%",
          top: "4%",
          background: "radial-gradient(circle at 35% 35%, rgba(139, 133, 193, 0.95), transparent 70%)",
        }}
      />
      <div
        className="pgg-blob"
        style={{
          width: 440,
          height: 440,
          right: "-8%",
          top: "12%",
          opacity: 0.32,
          animationDelay: "-7s",
          background: "radial-gradient(circle at 60% 40%, rgba(179, 249, 104, 0.85), transparent 70%)",
        }}
      />
      <div
        className="pgg-blob"
        style={{
          width: 400,
          height: 400,
          left: "32%",
          bottom: "-16%",
          opacity: 0.24,
          animationDelay: "-13s",
          background: "radial-gradient(circle at 50% 50%, rgba(255, 179, 71, 0.8), transparent 70%)",
        }}
      />

      <div className="pgg-grid" />
      <div className="pgg-horizon" />
    </div>
  );
}
