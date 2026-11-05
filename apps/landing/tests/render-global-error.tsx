// Renders the failing-to-start page on its own and prints its HTML (tests/qa-errors.mjs checks it): it can't be caused
// from a browser in a working build, since it only shows when the root layout itself fails.
import { renderToStaticMarkup } from "react-dom/server";
import GlobalError from "../app/global-error";

process.stdout.write(renderToStaticMarkup(<GlobalError />));
