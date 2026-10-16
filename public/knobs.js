// One setting on a settings panel, drawn the easy way for its kind:
//   'switch'   an on/off switch (the setting is 1 or 0)
//   'optional' a switch, plus the number only while it is on (the setting is 0 when off; `on` is the number it starts at)
//   anything else, a plain number box
// onChange(value) saves; it returns an error message to show, or nothing.
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
let seq = 0;

function toggle(text, checked) {
  const lab = el('label', 'switch-row'), box = el('input', 'switch'), name = el('span', '', text);
  box.type = 'checkbox'; box.setAttribute('role', 'switch'); box.checked = checked; lab.append(box, name);
  return [lab, box];
}

export function knob({ id, label, unit = '', value, min, max, step, kind, on, off, onChange }) {
  const wrap = el('div', `fieldwrap knob knob-${kind ?? 'number'}`), uid = `knob-${id}-${++seq}`;
  const number = () => { const i = el('input'); Object.assign(i, { type: 'number', inputMode: 'decimal', min: String(kind === 'optional' ? Math.max(step, min) : min), max: String(max), step: String(step), value: String(value), id: uid }); return i; };
  if (kind === 'switch') {
    const [row, box] = toggle(label, value === 1); box.id = uid;
    box.addEventListener('change', () => { const err = onChange(box.checked ? 1 : 0); if (err) box.checked = !box.checked; });
    wrap.append(row); return wrap;
  }
  if (kind === 'optional') {
    const [row, box] = toggle(label, value !== 0), line = el('div', 'knob-amount'), i = number(), u = el('span', 'muted', unit);
    if (value === 0) i.value = String(on ?? Math.max(step, min));
    line.append(i, u); line.hidden = value === 0; i.setAttribute('aria-label', `${label} (${unit || 'amount'})`);
    const note = el('span', 'muted knob-off', off ? `Off: ${off}` : 'Off'); note.hidden = value !== 0;
    box.addEventListener('change', () => { const v = box.checked ? Number(i.value) : 0, err = onChange(v); if (err) { box.checked = !box.checked; return; } line.hidden = !box.checked; note.hidden = box.checked; });
    i.addEventListener('change', () => { const err = onChange(Number(i.value)); if (err) i.value = String(value || on); else value = Number(i.value); });
    wrap.append(row, line, note); return wrap;
  }
  const l = el('label', '', `${label}${unit ? ` (${unit})` : ''}`), i = number(); l.htmlFor = uid;
  i.addEventListener('change', () => { const err = onChange(Number(i.value)); if (err) i.value = String(value); else value = Number(i.value); });
  wrap.append(l, i); return wrap;
}

/** One number a preset sets, shown read-only: the name on the left, its value on the right. */
export function fact({ label, unit = '', value, kind, off }) {
  const wrap = el('div', 'fieldwrap knob knob-fact'), name = el('span', 'fact-name', label);
  const text = kind === 'switch' ? (value === 1 ? 'On' : 'Off') : kind === 'optional' && value === 0 ? (off ? `Off (${off})` : 'Off') : unit === '$' ? `$${Number(value).toLocaleString('en-US')}` : `${typeof value === 'number' ? value.toLocaleString('en-US') : value}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
  wrap.append(name, el('b', `fact-value ${kind === 'switch' ? (value === 1 ? 'on' : 'off') : ''}`, text)); return wrap;
}

/** A heading for a group of settings. */
export const heading = (text, note) => { const f = document.createDocumentFragment(); f.append(el('h4', 'field-group', text)); if (note) f.append(el('p', 'muted field-group-note', note)); return f; };
