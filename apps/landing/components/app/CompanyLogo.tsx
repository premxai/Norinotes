"use client";

import { useState } from "react";

/*
 * A company's logo, or a letter tile in the same box (4a spec section 6, 4b spec section 6). `companyLogoUrl` is a
 * Brandfetch CDN address, which may only be shown in a plain <img>: no next/image, no proxying, no copies. It's null for
 * most companies (no known domain), and the CDN answers 404 when it has no logo, so the error event falls back too. The
 * name is always text beside it, so both are hidden from screen readers.
 */
export function CompanyLogo({ name, url }: { name: string; url: string | null | undefined }) {
  const [failed, setFailed] = useState<string | null>(null);
  // 36 px on phones, 40 px from 768: the same box for the logo and the tile, so nothing shifts when one gives way.
  const box = "size-9 rounded-[10px] text-base tablet:size-10";
  if (url && failed !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Brandfetch's terms allow only a plain <img> of their CDN
      <img
        src={url}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(url)}
        // Logos are drawn for light backgrounds, so their tile stays light in both themes.
        className={`${box} flex-none border-[1.5px] border-line bg-[#fffdf8] object-contain p-1`}
      />
    );
  }
  const letter = (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
  return (
    <span aria-hidden="true" className={`${box} grid flex-none place-items-center bg-tint font-semibold text-ink select-none`}>
      {letter}
    </span>
  );
}
