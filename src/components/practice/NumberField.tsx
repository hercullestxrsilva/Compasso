import { useId, useState } from 'react';
import { parseNumber, settleNumber } from '../../practice/setup';

const show = (value: number, integer: boolean) => (integer ? String(value) : String(value).replace('.', ','));

/**
 * What the student is typing in a number input, kept as text so "120" can be typed over "60": valid values are
 * applied as they are typed, out-of-range text reports an error and is clamped on blur.
 */
export function useNumberDraft(
  value: number,
  min: number,
  max: number,
  integer: boolean,
  onChange: (value: number) => void,
) {
  const [text, setText] = useState(() => show(value, integer)),
    [shown, setShown] = useState(value);
  if (value !== shown) {
    // The value changed elsewhere (a preset, tap tempo…): show it unless the draft already means it.
    setShown(value);
    if (parseNumber(text, min, max, integer).value !== value) setText(show(value, integer));
  }
  return {
    text,
    error: parseNumber(text, min, max, integer).error,
    change: (next: string) => {
      setText(next);
      const parsed = parseNumber(next, min, max, integer);
      if (parsed.value !== undefined && parsed.value !== value) onChange(parsed.value);
    },
    settle: () => {
      const settled = settleNumber(text, min, max, integer, value);
      setText(show(settled, integer));
      if (settled !== value) onChange(settled);
    },
  };
}

/** A labelled number field with its range (or what is wrong) always visible under it. */
export default function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  integer = true,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  integer?: boolean;
  hint?: string;
}) {
  const id = useId();
  const draft = useNumberDraft(value, min, max, integer, onChange);
  return (
    <label className="field number-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        enterKeyHint="done"
        autoComplete="off"
        value={draft.text}
        aria-invalid={draft.error ? true : undefined}
        aria-describedby={`${id}-hint`}
        onChange={e => draft.change(e.target.value)}
        onBlur={draft.settle}
      />
      <small id={`${id}-hint`} className={draft.error ? 'field-error' : undefined}>
        {draft.error ?? hint ?? `De ${min} a ${max}.`}
      </small>
    </label>
  );
}
