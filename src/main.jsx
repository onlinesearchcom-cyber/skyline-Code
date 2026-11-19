import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { installBrowserBridge } from "./skyline-browser";
import "./styles.css";

installBrowserBridge();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
