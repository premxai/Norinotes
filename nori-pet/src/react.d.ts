import type { ForwardRefExoticComponent, RefAttributes } from "react";
import type { NoriOptions, NoriPet } from "./index";

export interface NoriProps extends NoriOptions {
  onDrop?: (detail: { target: Element; id: string | null }) => void;
  onOpen?: () => void;
  onAnswer?: (detail: { text: string; value: unknown }) => void;
}

/** Creates Nori once for the component's lifetime; null until it is ready. */
export declare function useNori(options?: NoriOptions): NoriPet | null;

/** Mounts Nori; the ref is the NoriPet instance (null until ready). Renders nothing itself. */
export declare const Nori: ForwardRefExoticComponent<NoriProps & RefAttributes<NoriPet | null>>;

export default Nori;
