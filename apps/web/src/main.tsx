import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
// Inter, self-hosted, latin subset only. The token layer names Inter first in its font stack, so it has to
// actually be loaded — a system-ui fallback was rendering before this. The default `@fontsource/inter/*.css`
// entrypoints pull every subset in both woff and woff2 (~1 MB for an English-only app); the `latin-` ones
// ship the four weights we use at ~55 kB each.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles/theme.css";
import "./styles/app.css";
import { savedThemeMode } from "./gridTheme";

// Apply the user's saved theme before the first paint, so a dark-mode user never sees a light flash.
// Dark is the product default (and the stylesheet's), so with nothing saved there is nothing to apply.
const savedTheme = savedThemeMode();
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

const host = document.getElementById("root");
if (!host) throw new Error("apps/web: #root host element is missing from index.html");

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
