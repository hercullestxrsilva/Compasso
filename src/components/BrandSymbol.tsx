/**
 * The Compasso symbol: three rising bars (a crescendo) and an eighth note whose head is the accent dot.
 * Source artwork: brand/simbolo.svg. Strokes take currentColor; the note head uses --brand-accent unless mono.
 */
export default function BrandSymbol({
  size = 32,
  mono = false,
  className,
}: {
  /** Height in px; the width follows the symbol's proportions. */
  size?: number;
  mono?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="195 220 634 590"
      height={size}
      width={Math.round((size * 634) / 590)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M215,790 L215,560 L271,534.4 L271,678 L299,678 L299,790 Z M313,790 L313,678 L327,678 L327,508.8 L383,483.2 L383,678 L397,678 L397,790 Z M411,790 L411,678 L439,678 L439,457.6 L495,432 L495,790 Z"
      />
      <path
        fill="currentColor"
        d="M509,790 L509,240 C679,359 809,430 809,530 C809,558 803,582 791,605 L757,587.5 C763,575 767,555 767,530 C767,460 679,426 565,349.2 L565,790 Z"
      />
      <circle cx="683" cy="702" r="88" fill={mono ? 'currentColor' : 'var(--brand-accent)'} />
    </svg>
  );
}
