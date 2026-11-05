"use client";

import dynamic from "next/dynamic";

/*
 * The error pages, loaded only when one shows (error pages spec section 9). Next includes the root not-found page's
 * code with every page, so importing ErrorPages directly put the scene frame and every scene's preview (about 11 KB)
 * on the landing page's first screen. These still render on the server, so a 404 arrives with its words.
 */
export const NotFoundPage = dynamic(() =>
  import("./ErrorPages").then((m) => {
    const NotFound = () => <m.FullError kind="lost" />;
    return NotFound;
  }),
);
export const ShellNotFoundPage = dynamic(() =>
  import("./ErrorPages").then((m) => {
    const ShellNotFound = () => <m.ShellError kind="lost" />;
    return ShellNotFound;
  }),
);
