import type { ButtonHTMLAttributes, ReactNode } from "react";
import { BookmarkIcon, SpeakerIcon } from "./Icons";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  selected?: boolean;
  size: "bookmark" | "speaker";
  children: ReactNode;
}

function IconButton({
  label,
  selected = false,
  size,
  children,
  className = "",
  ...buttonProps
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`popover-icon-button popover-icon-button--${size} ${className}`.trim()}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      {...buttonProps}
    >
      {children}
    </button>
  );
}

export function BookmarkButton({
  saved,
  disabled = false,
  onToggle,
}: {
  saved: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      label={saved ? "Remove bookmark" : "Save bookmark"}
      selected={saved}
      size="bookmark"
      disabled={disabled}
      onClick={onToggle}
    >
      <BookmarkIcon filled={saved} />
    </IconButton>
  );
}

export function SpeakerButton({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      label="Preview pronunciation control"
      selected={active}
      size="speaker"
      onClick={onToggle}
    >
      <SpeakerIcon />
    </IconButton>
  );
}
