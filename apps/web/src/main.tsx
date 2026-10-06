import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./styles/theme.css";
import "./styles/app.css";

const host = document.getElementById("root");
if (!host) throw new Error("apps/web: #root host element is missing from index.html");

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
