import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function SpeakerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M5 10v4h3l4 3.25V6.75L8 10H5Z"
        fill="currentColor"
        stroke="currentColor"
        strokeLinejoin="round"
      />
      <path
        d="M15 9.1a4 4 0 0 1 0 5.8M17.5 6.75a7.2 7.2 0 0 1 0 10.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 2.75c.7 3.2 2.05 4.55 5.25 5.25-3.2.7-4.55 2.05-5.25 5.25C9.3 10.05 7.95 8.7 4.75 8 7.95 7.3 9.3 5.95 10 2.75Z"
        fill="currentColor"
      />
      <path d="M4 13.25c.32 1.45.93 2.07 2.4 2.4-1.47.31-2.08.93-2.4 2.35-.32-1.42-.93-2.04-2.4-2.35 1.47-.33 2.08-.95 2.4-2.4Z" fill="currentColor" />
    </svg>
  );
}

export function ErrorIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8v4.5M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function OfflineIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M3.75 9.15A12.5 12.5 0 0 1 7.1 7.1M11.25 5.55c3.25-.2 6.5.98 9 3.6M6.7 13a7.7 7.7 0 0 1 4.6-2.15M15.65 12a7.8 7.8 0 0 1 1.65 1M9.5 16.55A3.7 3.7 0 0 1 12 15.6c1 0 1.9.4 2.55 1.05M12 20h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
