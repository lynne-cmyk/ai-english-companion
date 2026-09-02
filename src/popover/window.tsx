import ReactDOM from "react-dom/client";
import { PopoverRenderer } from "./PopoverRenderer";
import "./tokens.css";
import "./popover.css";

ReactDOM.createRoot(document.getElementById("popover-root")!).render(
  <PopoverRenderer />,
);
