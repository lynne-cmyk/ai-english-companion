import React from "react";
import ReactDOM from "react-dom/client";
import { PermissionSetup } from "./PermissionSetup";
import "./permission-setup.css";

ReactDOM.createRoot(
  document.getElementById("permission-setup-root")!,
).render(
  <React.StrictMode>
    <PermissionSetup />
  </React.StrictMode>,
);
