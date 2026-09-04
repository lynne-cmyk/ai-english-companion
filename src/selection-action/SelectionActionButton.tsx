import type { ButtonHTMLAttributes } from "react";

export type SelectionActionVisualState =
  | "default"
  | "hover"
  | "pressed"
  | "focus";

type SelectionActionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> & {
  previewState?: SelectionActionVisualState;
  exiting?: boolean;
};

export function SelectionActionButton({
  previewState = "default",
  exiting = false,
  className = "",
  ...buttonProps
}: SelectionActionButtonProps) {
  const classes = [
    "selection-action-button",
    `selection-action-button--${previewState}`,
    exiting ? "selection-action-button--exiting" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...buttonProps}
      type="button"
      className={classes}
      aria-label="翻译选中文本"
    >
      <span className="selection-action-button__surface" aria-hidden="true">
        <svg
          className="selection-action-button__icon"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M12 2L13.8 10.2L22 12L13.8 13.8L12 22L10.2 13.8L2 12L10.2 10.2Z"
            fill="currentColor"
          />
        </svg>
      </span>
    </button>
  );
}
