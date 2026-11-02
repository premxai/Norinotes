"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";

/** Comma or Enter adds a chip, Backspace on an empty field removes the last one. Looks like an `inputClass` field. */
export function ChipInput({ value, onChange, placeholder, label }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; label: string }) {
  const [text, setText] = useState("");

  function commit(raw: string) {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) { setText(""); return; }
    const next = [...value];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setText("");
  }

  return (
    <div
      className={cx(
        "flex min-h-[38px] w-full flex-wrap items-center gap-1.5 rounded-[var(--radius-input)] border border-line bg-surface px-2 py-1.5 transition-colors duration-150",
        "hover:border-control focus-within:border-ink",
      )}
    >
      {value.map((v) => (
        <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line px-1.5 py-[2px] text-[12px] leading-[1.35] text-ink-2">
          <span className="truncate">{v}</span>
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="text-muted transition-colors duration-150 hover:text-ink">
            <Icon icon={X} size={12} />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={text}
        placeholder={value.length === 0 ? placeholder : ""}
        onChange={(e) => {
          if (e.target.value.includes(",")) commit(e.target.value);
          else setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(text); }
          else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => commit(text)}
        className="min-w-[8ch] flex-1 bg-transparent px-1 text-body-sm text-ink placeholder:text-muted focus:outline-none"
      />
    </div>
  );
}
