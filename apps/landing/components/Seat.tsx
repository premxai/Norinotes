import type { CSSProperties, ReactNode } from "react";
import { scenes, type SceneId } from "@/lib/scenes";

/**
 * The seat style for a point on a scene drawn with `object-fit: cover` (see Scene). It works out where the point
 * lands at any box size, in CSS alone, using container query units, so the scene's box must be a size container.
 * px and py are the object-position fractions (Scene's default is 50% 100%).
 */
export function seatStyle(id: SceneId, px = 0.5, py = 1): CSSProperties {
  const s = scenes[id];
  return { "--a": s.aspect, "--sx": s.seat.x, "--sy": s.seat.y, "--px": px, "--py": py } as CSSProperties;
}

/**
 * Where Nori sits on a scene: a 1 px marker at the seat point, named for the seat controller (`data-nori-seat`).
 * Anything inside it (Nori's note in the hero) is positioned from the seat.
 */
export function Seat({ name, scene, px = 0.5, py = 1, className = "", children }: { name: string; scene: SceneId; px?: number; py?: number; className?: string; children?: ReactNode }) {
  return (
    <div data-nori-seat={name} className={`nori-seat ${className}`} style={seatStyle(scene, px, py)}>
      {children}
    </div>
  );
}
