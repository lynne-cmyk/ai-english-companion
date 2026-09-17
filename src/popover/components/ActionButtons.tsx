import type { ButtonHTMLAttributes, ReactNode } from "react";
import { SpeakerIcon } from "./Icons";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  selected?: boolean;
  size: "speaker";
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

export function SpeakerButton({
  active,
  disabled = false,
  onToggle,
}: {
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      label="Preview pronunciation control"
      selected={active}
      size="speaker"
      disabled={disabled}
      onClick={onToggle}
    >
      <SpeakerIcon />
    </IconButton>
  );
}
