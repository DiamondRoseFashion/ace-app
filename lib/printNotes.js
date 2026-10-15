'use client';
// Prints ONLY a project's notes: a clean page with the project details
// on top and the notes underneath (nothing else from the screen).
import { fmtDate } from '@/lib/dates';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeOf = (v) => { const d = new Date(v); const h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

// info: { name, quotation, salesPerson, client, contractor, consultant, supportedBy }
export function printNotes(notes, info = {}) {
  const rows = [
    ['Project', info.name], ['Quotation No', info.quotation], ['Sales Person', info.salesPerson],
    ['Contractor', info.contractor], ['Client', info.client], ['Consultant', info.consultant],
    ['Supported By', info.supportedBy],
  ].filter(([, v]) => v);
  const now = new Date();
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Project Notes - ${esc(info.name || '')}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1d1424; margin: 0; font-size: 12.5px; }
  .head { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #0F1F3D; padding-bottom: 10px; margin-bottom: 14px; }
  .head img { width: 46px; height: 46px; border-radius: 10px; }
  .head h1 { font-size: 20px; margin: 0; color: #0F1F3D; }
  .head .sub { color: #6E6079; font-size: 11.5px; margin-top: 2px; }
  table.info { border-collapse: collapse; margin-bottom: 16px; }
  table.info td { padding: 3px 14px 3px 0; vertical-align: top; }
  table.info td:first-child { color: #6E6079; white-space: nowrap; }
  table.info td:last-child { font-weight: 600; }
  table.notes { width: 100%; border-collapse: collapse; }
  table.notes th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; color: #6E6079; border-bottom: 1.5px solid #CFC6D8; padding: 6px 8px; }
  table.notes td { border-bottom: 1px solid #E6E0EC; padding: 8px; vertical-align: top; }
  table.notes tr { page-break-inside: avoid; }
  td.when { white-space: nowrap; width: 128px; color: #3b2f45; }
  td.who { white-space: nowrap; width: 150px; font-weight: 600; }
  td.body { white-space: pre-wrap; }
  .empty { color: #6E6079; padding: 12px 0; }
  .foot { margin-top: 18px; color: #8A7B96; font-size: 10.5px; }
</style></head><body>
  <div class="head">
    <img src="${location.origin}/icon-192.png" alt="">
    <div><h1>Project Notes</h1><div class="sub">ACE · Gems Systems L.L.C. · Printed ${esc(fmtDate(now))} ${esc(timeOf(now))}</div></div>
  </div>
  ${rows.length ? `<table class="info">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
  ${notes.length ? `<table class="notes"><thead><tr><th>Date &amp; time</th><th>By</th><th>Note</th></tr></thead><tbody>
    ${notes.map((n) => `<tr><td class="when">${esc(fmtDate(n.created_at))}<br>${esc(timeOf(n.created_at))}</td><td class="who">${esc(n.author?.full_name || 'Someone')}</td><td class="body">${esc(n.body)}</td></tr>`).join('')}
  </tbody></table>` : '<div class="empty">No notes yet.</div>'}
  <div class="foot">${notes.length} note${notes.length === 1 ? '' : 's'}, newest first.</div>
</body></html>`;

  // print from a hidden frame (no pop-up window to be blocked)
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  const go = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { /* ignore */ }
    setTimeout(() => frame.remove(), 60 * 1000);
  };
  const img = doc.querySelector('img');
  if (img && !img.complete) { img.onload = go; img.onerror = go; setTimeout(go, 1500); } else setTimeout(go, 150);
}
