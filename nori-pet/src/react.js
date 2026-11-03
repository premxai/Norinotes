"use client";
// React wrapper: <Nori ref={noriRef} assets="/nori/" onDrop={...} /> mounts the companion and exposes the instance.
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { NoriPet } from "./nori-pet.js";

/** Creates Nori once for the component's lifetime; returns null until it is ready. */
export function useNori(options) {
  const [pet, setPet] = useState(null);
  useEffect(() => {
    let alive = true;
    let made = null;
    NoriPet.create(options).then((p) => { if (alive) { made = p; setPet(p); } else p.destroy(); });
    return () => { alive = false; made?.destroy(); };
    // Options are read once; change size or mute through the instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return pet;
}

export const Nori = forwardRef(function Nori({ onDrop, onOpen, onAnswer, onPet, ...options }, ref) {
  const pet = useNori({ ...options, onPet });
  useImperativeHandle(ref, () => pet, [pet]);
  useEffect(() => {
    if (!pet) return undefined;
    const offs = [onDrop && pet.on("drop", onDrop), onOpen && pet.on("open", onOpen), onAnswer && pet.on("answer", onAnswer)].filter(Boolean);
    return () => offs.forEach((off) => off());
  }, [pet, onDrop, onOpen, onAnswer]);
  return null;
});

export default Nori;
