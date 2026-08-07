import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { loadRememberedAiKey } from "./stores/useAiStore";

// The AI key is no longer persisted in local storage; if one was remembered in
// the OS credential store, pull it into memory. Fire-and-forget: the app is
// fully usable without AI, so nothing should wait on this.
void loadRememberedAiKey();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
