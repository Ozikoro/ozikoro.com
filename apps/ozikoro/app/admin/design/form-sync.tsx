'use client';

import { useEffect } from 'react';

/**
 * The two controls on the token rows that a native form gets wrong, made right on submit.
 *
 * ── WHY THIS EXISTS AT ALL, WHICH IS NOT FOR THE PLEASURE OF ADDING JAVASCRIPT ───────────────────────
 *
 * A token row in the owner's design carries BOTH a native `<input type="color">` and a text box, and the
 * save path (`/api/admin/design`, and the preview route) reads `value_text` FIRST — the documented rule,
 * added a round earlier, because a picker cannot express `rgba(…)`, `hsl(…)` or a gradient. That rule
 * makes the picker a control that posts a field nobody reads whenever the text box also has a value. The
 * two honest ways out:
 *
 *   1. leave the text box empty and show the value in force as its placeholder — but then the value the
 *      owner is looking at is not the value in the box, which is its own small lie; or
 *   2. seed the box with the value in force, and **make a picker change write itself into the box**.
 *
 * This is (2). The same problem exists on a font row in the other direction: the design's chooser and the
 * token's own stack text box must not be able to overwrite one another, so the chooser posts a field of
 * its own (`fontValue`) — and a stack the owner has TYPED has to win when he never touched the chooser.
 *
 * ── AND WHY IT IS A DELEGATED `submit` LISTENER RATHER THAN A REACT BINDING ON EACH INPUT ────────────
 *
 * Because every one of these forms is a plain `<form method="post">` over a server-rendered document, and
 * **it must keep working with this script absent.** With no JavaScript the page is fully usable: the
 * seeded text box IS the value in force and saving it is a complete edit; the chooser is unusable but the
 * box beside it is not. So this adds a convenience and never carries a requirement. The listener is on the
 * document, taken once in an effect, because the tab body is re-rendered from the server on every
 * navigation and a listener bound to an element would go with it.
 */
export function DesignFormSync() {
  useEffect(() => {
    function onSubmit(event: Event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;

      /*
       * ⚠️ AN UNTOUCHED PICKER MUST NOT WRITE ANYTHING.
       *
       * The box beside it is seeded with the value IN FORCE, which is the published baseline and not the
       * picker's `#rrggbb`, and a colour row is submitted even when the owner only came to read it. Copying
       * the picker's value unconditionally would therefore turn "I looked at the palette" into `--ink-faint`
       * being written as the design's own #8d8577 — undoing the accessibility correction `/a11y.css` makes
       * and recording an edit the owner never made. **`value !== defaultValue` is the browser's own record
       * that the picker was touched**, and only then is its colour the answer.
       */
      form.querySelectorAll<HTMLInputElement>('[data-field-sync]').forEach((picker) => {
        if (picker.value === picker.defaultValue) return;
        const box = form.querySelector<HTMLInputElement>(picker.dataset.fieldSync ?? '');
        if (box) box.value = picker.value;
      });

      /*
       * A FONT ROW'S BOX IS SEEDED EMPTY, SO "TYPED INTO" IS `value !== ''` — and that emptiness is what
       * makes the chooser usable at all. A box pre-filled with the stack in force would make every submit a
       * typed-in edit, so the chooser beside it could never once win. The value in force is the box's
       * `placeholder` and the row's own `small` line, so nothing is hidden by the box being empty.
       */
      form.querySelectorAll<HTMLInputElement>('[data-font-field]').forEach((hidden) => {
        const token = hidden.dataset.fontField ?? '';
        const box = form.querySelector<HTMLInputElement>(`[data-font-text="${token}"]`);
        const picker = form.querySelector<HTMLSelectElement>(`[data-font-picker="${token}"]`);
        if (box && box.value.trim().length > 0) hidden.value = box.value;
        else if (picker && picker.value) hidden.value = picker.value;
      });
    }

    document.addEventListener('submit', onSubmit, true);
    return () => document.removeEventListener('submit', onSubmit, true);
  }, []);

  return null;
}
