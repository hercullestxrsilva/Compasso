import { useId, useState } from 'react';
import { parseNumber, settleNumber } from '../../practice/setup';

/**
 * A number input that keeps what the student types (so "120" can be typed over "60") and only settles on
 * blur: valid values are applied as they are typed, out-of-range text shows a hint and is clamped on blur.
 */
export default function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  integer = true,
  hint,
  compact = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  integer?: boolean;
  hint?: string;
  /** Input only (the label becomes its accessible name), for tight rows such as routine steps. */
  compact?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(String(value)),
    [shown, setShown] = useState(value);
  if (value !== shown) {
    // The value changed elsewhere (a preset, tap tempo…): show it unless the draft already means it.
    setShown(value);
    if (parseNumber(text, min, max, integer).value !== value) setText(String(value));
  }
  const error = parseNumber(text, min, max, integer).error;
  const input = (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      enterKeyHint="done"
      autoComplete="off"
      value={text}
      aria-label={compact ? label : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={compact ? undefined : `${id}-hint`}
      title={compact ? (error ?? `De ${min} a ${max}`) : undefined}
      onChange={e => {
        setText(e.target.value);
        const parsed = parseNumber(e.target.value, min, max, integer);
        if (parsed.value !== undefined && parsed.value !== value) onChange(parsed.value);
      }}
      onBlur={() => {
        const settled = settleNumber(text, min, max, integer, value);
        setText(String(settled));
        if (settled !== value) onChange(settled);
      }}
    />
  );
  if (compact) return <span className="number-compact">{input}</span>;
  return (
    <label className="field number-field">
      <span>{label}</span>
      {input}
      <small id={`${id}-hint`} className={error ? 'field-error' : undefined}>
        {error ?? hint ?? `De ${min} a ${max}.`}
      </small>
    </label>
  );
}
