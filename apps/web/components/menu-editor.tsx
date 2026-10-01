'use client';

/**
 * The menu, dragged into order.
 *
 * The owner: "let the admin be able to edit and change any colour or any design from the website,
 * even if it means drag and drop to make it easy like wordpress does."
 *
 * This is the WordPress Menus screen in miniature: the items are rows you drag, each row is a
 * label and an address, and the order you leave them in is the order in the header. It submits one
 * hidden field of JSON, so the server keeps doing what it did with the typed version —
 * /admin/appearance still shows a textarea for anyone who would rather type.
 */
import { useState } from 'react';

export interface MenuRow {
  label: string;
  href: string;
  emphasis?: boolean;
}

export function MenuEditor({ initial }: { initial: MenuRow[] }) {
  const [rows, setRows] = useState<MenuRow[]>(initial.length > 0 ? initial : [{ label: '', href: '' }]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const update = (i: number, patch: Partial<MenuRow>) =>
    setRows((r) => r.map((row, n) => (n === i ? { ...row, ...patch } : row)));

  const move = (from: number, to: number) => {
    if (from === to) return;
    setRows((r) => {
      const next = [...r];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });
  };

  return (
    <div className="cd-drag">
      <input type="hidden" name="menuItems" value={JSON.stringify(rows.filter((r) => r.label && r.href))} />

      <ul className="cd-draglist">
        {rows.map((row, i) => (
          <li
            key={i}
            className={`cd-dragrow${dragOver === i ? ' cd-dragover' : ''}${dragFrom === i ? ' cd-dragfrom' : ''}`}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) move(dragFrom, i);
              setDragFrom(null);
              setDragOver(null);
            }}
          >
            <span className="cd-grip" title="Drag to reorder" aria-hidden="true">
              ⠿
            </span>
            <input
              type="text"
              value={row.label}
              placeholder="Label"
              maxLength={60}
              onChange={(e) => update(i, { label: e.target.value })}
              aria-label={`Label for item ${i + 1}`}
            />
            <input
              type="text"
              value={row.href}
              placeholder="/address or https://…"
              maxLength={300}
              onChange={(e) => update(i, { href: e.target.value })}
              aria-label={`Address for item ${i + 1}`}
            />
            <label className="cd-emph" title="Show with the donate treatment">
              <input
                type="checkbox"
                checked={Boolean(row.emphasis)}
                onChange={(e) => update(i, { emphasis: e.target.checked })}
              />
              <span>emphasis</span>
            </label>
            <button
              type="button"
              className="cd-x"
              title="Remove this item"
              onClick={() => setRows((r) => r.filter((_, n) => n !== i))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <p className="wphelp" style={{ marginTop: '0.5rem' }}>
        Drag the handle to reorder. The order here is the order in the header.
      </p>
      <p style={{ marginTop: '0.5rem' }}>
        <button
          type="button"
          className="wpbtn wpbtn-quiet wpbtn-mini"
          onClick={() => setRows((r) => [...r, { label: '', href: '' }])}
        >
          + Add menu item
        </button>
      </p>
    </div>
  );
}
