'use client';

/**
 * The front page, dragged into order.
 *
 * The owner asked for drag-and-drop design editing "like wordpress does", and WordPress's Widgets
 * and Customizer screens are exactly this: a list of named sections you reorder, and a switch that
 * takes one off the page without deleting it. Same idea here — the page is drawn from this list,
 * in this order, and a switched-off block simply is not drawn.
 */
import { useState } from 'react';

export interface BlockRow {
  id: string;
  label: string;
  note: string;
  on: boolean;
}

export function BlockEditor({ blocks, initialOrder }: { blocks: BlockRow[]; initialOrder: string[] }) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const start = [
    ...initialOrder.filter((id) => byId.has(id)),
    ...blocks.filter((b) => !initialOrder.includes(b.id)).map((b) => b.id),
  ];

  const [order, setOrder] = useState<string[]>(start);
  const [on, setOn] = useState<Record<string, boolean>>(
    Object.fromEntries(blocks.map((b) => [b.id, initialOrder.includes(b.id)]))
  );
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (from === to) return;
    setOrder((o) => {
      const next = [...o];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });
  };

  const live = order.filter((id) => on[id]);

  return (
    <div className="cd-drag">
      <input type="hidden" name="homeBlocks" value={JSON.stringify(live)} />

      <ul className="cd-draglist">
        {order.map((id, i) => {
          const b = byId.get(id);
          if (!b) return null;
          return (
            <li
              key={id}
              className={`cd-dragrow cd-blockrow${dragOver === i ? ' cd-dragover' : ''}${dragFrom === i ? ' cd-dragfrom' : ''}${on[id] ? '' : ' cd-blockoff'}`}
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
              <span className="cd-grip" title="Drag to reorder" aria-hidden="true">⠿</span>
              <span className="cd-blockname">
                <strong>{b.label}</strong>
                <span className="wphelp">{b.note}</span>
              </span>
              <label className="cd-emph">
                <input type="checkbox" checked={on[id]} onChange={(e) => setOn((v) => ({ ...v, [id]: e.target.checked }))} />
                <span>show</span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="wphelp" style={{ marginTop: '0.6rem' }}>
        Drag to reorder. Untick a block to take it off the front page without forgetting where it was.
      </p>
      <p className="wphelp">
        Showing now, top to bottom: <strong>{live.length === 0 ? 'nothing — the front page would be empty' : live.map((id) => byId.get(id)?.label).join(' → ')}</strong>
      </p>
    </div>
  );
}
