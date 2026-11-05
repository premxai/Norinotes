"use client";

import { useState } from "react";

/*
 * The app failing to start (error pages spec section 4): an error in the root layout itself, so this page replaces the
 * whole document and relies on nothing else: its own styles, system fonts, no images, no Nori. Try again reloads,
 * since with the layout broken a reset can't help. The error's details never reach the page.
 */

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;background:#FBF4EA;color:#1F2A24;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{min-height:100svh;display:flex;align-items:center;justify-content:center;padding:48px 20px}
.box{width:100%;max-width:420px;display:flex;flex-direction:column;gap:14px}
.name{margin:0;font-weight:700;font-size:17px}
h1{margin:0;font-size:32px;line-height:1.15;font-weight:600}
p{margin:0;font-size:17px;line-height:1.55}
.lead{color:#55605A}
button{align-self:flex-start;min-height:48px;padding:0 22px;border:0;border-radius:999px;background:#2F5D46;color:#FFFDF8;font:600 16px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}
button:focus-visible{outline:2px solid #1F2A24;outline-offset:3px}
@media (max-width:767px){main{align-items:flex-start}h1{font-size:28px}p{font-size:16px}}
`;

export default function GlobalError() {
  const [reloading, setReloading] = useState(false);
  return (
    <html lang="en">
      <head>
        <title>Norinote</title>
        <meta name="robots" content="noindex" />
        <style>{CSS}</style>
      </head>
      <body>
        <main>
          <div className="box">
            <p className="name">Norinote</p>
            <h1>Norinote couldn&rsquo;t load</h1>
            <p className="lead">Check your connection, then try again.</p>
            <button
              type="button"
              onClick={() => {
                setReloading(true);
                location.reload();
              }}
            >
              Try again
            </button>
            <p role="status" className="lead">
              {reloading ? "Reloading…" : ""}
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
