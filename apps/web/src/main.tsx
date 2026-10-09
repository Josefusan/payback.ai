import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
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
