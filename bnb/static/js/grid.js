/* The availability grid.
 *
 * This is a real <table> with <th scope="col"> for nights and <th scope="row">
 * for rooms, not a div soup with role="grid".  Screen readers then announce
 * "Garden Room, Friday 3 April, booked, Jonas" from the table semantics alone,
 * with no ARIA bookkeeping to drift out of sync.
 *
 * On top of that sits a roving tabindex: the grid holds one tab stop, and the
 * arrow keys move a cursor within it.  Without this a three-month view for six
 * rooms is over five hundred tab stops between the grid and the next control,
 * which is not a usable keyboard experience for anybody.
 */

import { addDays, toLocalDate } from './format.js';

export function renderGrid({ mount, data, start, end, today, fmt, t, onSelect }) {
  const nights = [];
  for (let iso = start; iso < end; iso = addDays(iso, 1)) nights.push(iso);

  const table = document.createElement('table');
  table.className = 'calendar';
  const caption = document.createElement('caption');
  caption.className = 'visually-hidden';
  caption.textContent = `${t('cal.grid_label')} — ${fmt.fullDate(start)} … ${fmt.fullDate(addDays(end, -1))}`;
  table.appendChild(caption);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const corner = document.createElement('td');
  corner.setAttribute('scope', 'col');
  headRow.appendChild(corner);

  for (const iso of nights) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (fmt.isWeekend(iso)) th.classList.add('is-weekend');
    if (iso === today) th.classList.add('is-today');
    const dow = document.createElement('span');
    dow.className = 'dow';
    dow.textContent = fmt.weekdayNarrow(iso);
    th.appendChild(document.createTextNode(String(toLocalDate(iso).getDate())));
    th.appendChild(dow);
    // The narrow weekday and bare day number are shorthand for sighted users;
    // assistive technology gets the unabbreviated date instead.
    const label = document.createElement('span');
    label.className = 'visually-hidden';
    label.textContent = fmt.fullDate(iso);
    th.appendChild(label);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const room of data.rooms) {
    const tr = document.createElement('tr');
    const rowHead = document.createElement('th');
    rowHead.scope = 'row';
    rowHead.textContent = room.name;
    const capacity = document.createElement('small');
    capacity.textContent = `${room.capacity}p`;
    rowHead.appendChild(capacity);
    tr.appendChild(rowHead);

    const cells = data.nights[room.id] || {};
    for (const iso of nights) {
      const td = document.createElement('td');
      td.appendChild(buildCell({ room, iso, cell: cells[iso], fmt, t, onSelect }));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  mount.replaceChildren(table);
  installRovingFocus(table);
  return table;
}

function buildCell({ room, iso, cell, fmt, t, onSelect }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cell';
  button.tabIndex = -1;                      // the roving cursor grants this
  button.dataset.state = cell ? cell.state : 'open';
  button.dataset.night = iso;
  button.dataset.roomId = String(room.id);
  if (cell?.booking_id) button.dataset.bookingId = String(cell.booking_id);
  if (cell?.arrival) button.dataset.arrival = 'true';

  // Colour is never the only signal: each state also carries a glyph and,
  // for off-sale nights, a stripe pattern from the stylesheet.
  const stateLabel = {
    sold: t('cal.sold'), held: t('cal.held'), closed: t('cal.closed'),
  }[cell?.state] || t('cal.open');

  let glyph = '';
  if (cell?.state === 'sold') glyph = initials(cell.guest) || '●';
  else if (cell?.state === 'held') glyph = '◑';
  else if (cell?.state === 'closed') glyph = '✕';
  button.textContent = glyph;

  const parts = [room.name, fmt.fullDate(iso), stateLabel];
  if (cell?.guest) parts.push(cell.guest);
  if (cell?.channel) parts.push(cell.channel);
  if (cell?.reason) parts.push(cell.reason);
  if (cell?.arrival) parts.push(t('cal.arrival'));
  button.setAttribute('aria-label', parts.join(', '));

  button.addEventListener('click', () => onSelect?.({ room, iso, cell }));
  return button;
}

function initials(name) {
  if (!name) return '';
  // Intl.Segmenter keeps this correct for scripts where a "letter" is not one
  // code unit; the slice is a fallback for older engines.
  return [...String(name).trim()][0]?.toUpperCase() || '';
}

function installRovingFocus(table) {
  const rows = [...table.querySelectorAll('tbody tr')]
    .map((tr) => [...tr.querySelectorAll('button.cell')]);
  if (!rows.length || !rows[0].length) return;

  let row = 0;
  let col = 0;
  rows[0][0].tabIndex = 0;

  const focus = (nextRow, nextCol) => {
    const clampedRow = Math.max(0, Math.min(rows.length - 1, nextRow));
    const line = rows[clampedRow];
    const clampedCol = Math.max(0, Math.min(line.length - 1, nextCol));
    rows[row][col].tabIndex = -1;
    row = clampedRow;
    col = clampedCol;
    const target = rows[row][col];
    target.tabIndex = 0;
    target.focus();
  };

  table.addEventListener('keydown', (event) => {
    // In a right-to-left layout the left arrow must still mean "towards the
    // start of the row" as the reader sees it, which is the opposite column
    // direction.
    const rtl = getComputedStyle(table).direction === 'rtl';
    const forward = rtl ? -1 : 1;
    const handlers = {
      ArrowRight: () => focus(row, col + forward),
      ArrowLeft: () => focus(row, col - forward),
      ArrowDown: () => focus(row + 1, col),
      ArrowUp: () => focus(row - 1, col),
      Home: () => focus(row, 0),
      End: () => focus(row, rows[row].length - 1),
      PageDown: () => focus(row, col + 7),
      PageUp: () => focus(row, col - 7),
    };
    const handler = handlers[event.key];
    if (!handler) return;
    event.preventDefault();
    handler();
  });

  // A pointer user clicking a cell moves the cursor there too, so the next
  // arrow press continues from where they are looking.
  table.addEventListener('focusin', (event) => {
    const cell = event.target.closest('button.cell');
    if (!cell) return;
    for (let r = 0; r < rows.length; r += 1) {
      const c = rows[r].indexOf(cell);
      if (c !== -1) {
        rows[row][col].tabIndex = -1;
        row = r; col = c;
        cell.tabIndex = 0;
        return;
      }
    }
  });
}
