import React from "react";
import ReactDOM from "react-dom/client";
import { ApiKeySetup } from "./ApiKeySetup";
import "./api-key-setup.css";

ReactDOM.createRoot(
  document.getElementById("api-key-setup-root")!,
).render(
  <React.StrictMode>
    <ApiKeySetup />
  </React.StrictMode>,
);
