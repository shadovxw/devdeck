import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";
import { startInputMode } from "./lib/input-mode";
import { syncThemes } from "./theme/store"; // also puts the saved theme on the page

startInputMode();
void syncThemes();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
