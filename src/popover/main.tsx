import React from "react";
import ReactDOM from "react-dom/client";
import { PopoverPreview } from "./PopoverPreview";
import "./tokens.css";
import "./popover.css";

ReactDOM.createRoot(document.getElementById("popover-root")!).render(
  <React.StrictMode>
    <PopoverPreview />
  </React.StrictMode>,
);
