/**
 * Inline SVG icons.
 *
 * Inline, and not an icon package, for the same reason there are no web
 * fonts (see theme.css): the platform has to work with no network at all,
 * and a handful of 16×16 strokes is not worth a dependency, a build step or
 * a sprite sheet. Every icon here earns its place by appearing in the UI —
 * this file is not a library.
 *
 * They are decorations, never the label. Each is `aria-hidden` and inherits
 * `currentColor`; the control around it carries the text or the
 * `aria-label`, so nothing here ever needs to be read aloud.
 */

type IconProps = { readonly size?: number };

function Icon({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 8H3" />
      <path d="M7 4 3 8l4 4" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8h10" />
      <path d="m9 4 4 4-4 4" />
    </Icon>
  );
}

/** Run the query. Filled, not outlined: it is the one button in the
 * practice card that does something irreversible to the sandbox. */
export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 3.5 12.5 8 5 12.5z" fill="currentColor" />
    </Icon>
  );
}

/** Reset the sandbox / re-take the course — the same gesture at two scales,
 * so deliberately the same glyph. */
export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.9-4.2" />
      <path d="M13.5 2v3.2h-3.2" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3 8.5 3.2 3.2L13 5" />
    </Icon>
  );
}

/** Progress transfer: one file going out, one coming back. */
export function TransferIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 10v2.5h8V10" />
      <path d="M8 2.5v7" />
      <path d="M5.2 6.8 8 9.6l2.8-2.8" />
    </Icon>
  );
}

/** Reveal the reference answer. */
export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.8" />
    </Icon>
  );
}

/** Days in a row — the one warm glyph in a green palette, which is the
 * point: a streak belongs to the learner, not to the platform. */
export function FlameIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 1.5s3.5 3 3.5 6.2a3.5 3.5 0 0 1-7 0c0-1.2.6-2.2 1.3-3 .1 1 .7 1.6 1.4 1.6.9 0 1.3-.8 1.1-2-.1-1-.6-1.9-.3-2.8z" />
    </Icon>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 1.5H4.5v13h7V4z" />
      <path d="M9 1.5V4h2.5" />
    </Icon>
  );
}
