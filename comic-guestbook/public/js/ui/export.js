// Save and print: the comic as a picture, the transcript as text, a JSON
// backup, and a print layout. Pictures are made in the browser on demand.

import { h, formatTime } from '../lib/dom.js';
import { state, bus } from '../state.js';
import { panels, view } from '../data.js';
import { openDialog } from './dialog.js';
import { renderPanelCanvas } from '../render/panelcanvas.js';
import { emotionLabel } from '../shared/emotion.js';

const toast = (text, error = false) => bus.emit('toast', { text, error });

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** Plain-text transcript of the visible history. */
export function transcript(entries = state.entries.map(view).filter(Boolean)) {
  const lines = [`${state.room?.name ?? 'Guestbook'} — transcript saved ${new Date().toLocaleString()}`, ''];
  for (const e of entries) {
    const t = new Date(e.ts).toLocaleString();
    switch (e.kind) {
      case 'action': lines.push(`[${t}] * ${e.author} ${e.text}`); break;
      case 'think': lines.push(`[${t}] ${e.author} . o O ( ${e.text} )`); break;
      case 'whisper': lines.push(`[${t}] ${e.author} whispers: ${e.text}`); break;
      case 'expression': lines.push(`[${t}] * ${e.author} looks ${emotionLabel(e.em).toLowerCase()}.`); break;
      default: lines.push(`[${t}] ${e.author}: ${e.text}`);
    }
  }
  return lines.join('\n');
}

/** A contact sheet of the last `count` panels, `cols` across. */
async function sheet(art, count, cols, panelPx) {
  const all = panels();
  const list = all.slice(Math.max(0, all.length - count));
  const rows = Math.ceil(list.length / cols);
  const gap = 12;
  const canvas = document.createElement('canvas');
  canvas.width = cols * panelPx + (cols + 1) * gap;
  canvas.height = rows * panelPx + (rows + 1) * gap;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < list.length; i++) {
    const c = await renderPanelCanvas(art, list[i], panelPx, state.prefs);
    ctx.drawImage(c, gap + (i % cols) * (panelPx + gap), gap + Math.floor(i / cols) * (panelPx + gap));
  }
  return canvas;
}

export function openExport(kind, art) {
  if (kind === 'txt') {
    download(new Blob([transcript()], { type: 'text/plain;charset=utf-8' }), `guestbook-${stamp()}.txt`);
    toast('Transcript saved.');
    return;
  }
  if (kind === 'json') {
    const data = JSON.stringify({ room: state.room?.name, saved: new Date().toISOString(), entries: state.entries }, null, 1);
    download(new Blob([data], { type: 'application/json' }), `guestbook-backup-${stamp()}.json`);
    toast('Backup saved.');
    return;
  }

  const total = panels().length;
  const isPrint = kind === 'print';
  const countSel = h('select', { id: 'ex-count' },
    ...[[6, 'The last 6 panels'], [12, 'The last 12 panels'], [24, 'The last 24 panels'], [60, 'The last 60 panels']]
      .filter(([n]) => n <= Math.max(6, total) || n === 6)
      .map(([n, t]) => h('option', { value: n }, t)));
  const colSel = h('select', { id: 'ex-cols' },
    ...[2, 3, 4].map((n) => h('option', { value: n, selected: n === (isPrint ? 2 : 3) }, `${n} per row`)));
  const note = h('p.hint', total ? `${total} panels in the strip.` : 'The strip is empty.');
  openDialog({
    title: isPrint ? 'Print' : 'Save comic as picture',
    body: h('form.form-grid', { onsubmit: (e) => e.preventDefault() },
      h('label', { for: 'ex-count' }, 'Include'), countSel,
      h('label', { for: 'ex-cols' }, 'Layout'), colSel,
      h('div.full', note)),
    actions: [
      {
        label: isPrint ? 'Print…' : 'Save picture', primary: true, disabled: !total,
        onclick: async (close, btn) => {
          btn.textContent = 'Drawing…';
          try {
            const n = Number(countSel.value);
            const cols = Number(colSel.value);
            const canvas = await sheet(art, n, cols, isPrint ? 600 : 520);
            if (isPrint) {
              const img = h('img', { src: canvas.toDataURL('image/png'), alt: 'Comic strip', class: 'print-sheet' });
              const wrap = h('div.print-only', img);
              document.body.append(wrap);
              close();
              await new Promise((r) => setTimeout(r, 150));
              window.print();
              setTimeout(() => wrap.remove(), 1000);
            } else {
              canvas.toBlob((blob) => {
                if (blob) download(blob, `guestbook-comic-${stamp()}.png`);
                toast('Picture saved.');
              }, 'image/png');
              close();
            }
          } catch (e) {
            toast(`Could not draw the picture: ${e.message}`, true);
            btn.textContent = isPrint ? 'Print…' : 'Save picture';
            btn.disabled = false;
          }
        },
      },
      { label: 'Cancel', onclick: (c) => c() },
    ],
  });
}

export { formatTime };
