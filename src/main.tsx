import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { canonicalizeLocation } from "./nav.ts";
import "./styles.css";

// The static build's pages sit at different depths under one <base>. Making it absolute keeps
// relative URLs (data/, assets, icons) on the site root after history.pushState changes the path.
const base = document.querySelector("base");
if (base) base.setAttribute("href", base.href);
canonicalizeLocation();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
