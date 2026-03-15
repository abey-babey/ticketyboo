/* ─── Ticketyboo Admin Panel ─────────────────────────────────────────────────── */

'use strict';

// ── Token helpers ──────────────────────────────────────────────────────────────
function getToken()           { return sessionStorage.getItem('authToken'); }

function authHeaders() {
  const t = getToken();
  return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

// ── API helper ─────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: authHeaders() };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const j = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(j.error || res.statusText);
  }
  return res.json();
}

// ── Toast ──────────────────────────────────────────────────────────────────────
let _toastTimer;
function toast(msg, type = 'default') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'toast' + (type === 'error' ? ' toast-error' : type === 'ok' ? ' toast-ok' : '');
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ── Loading overlay ────────────────────────────────────────────────────────────
function showLoading(on) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !on);
}

// ── State ──────────────────────────────────────────────────────────────────────
let currentUser   = null;
const state = {
  logs:      { page: 1, filters: {} },
  customers: { page: 1, filters: {} },
  purchases: { page: 1, filters: {} },
  support:   { page: 1, filters: {} }
};
let autoRefreshInterval = null;

// ── Auth check ─────────────────────────────────────────────────────────────────
async function initAuth() {
  const token = getToken();
  if (!token) return redirectToSite();

  try {
    const data = await api('GET', '/api/auth/session');
    if (!data.user || data.user.role !== 'admin') return redirectToSite();
    currentUser = data.user;
    document.getElementById('sidebar-username').textContent = currentUser.username;
  } catch (_) {
    redirectToSite();
  }
}

function redirectToSite() {
  window.location.href = '/';
}

// ── Navigation ─────────────────────────────────────────────────────────────────
const SECTIONS = ['dashboard', 'logs', 'customers', 'purchases', 'support'];

function showSection(name) {
  if (!SECTIONS.includes(name)) name = 'dashboard';

  SECTIONS.forEach(s => {
    document.getElementById('section-' + s).classList.toggle('hidden', s !== name);
  });
  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.section === name);
  });

  // Stop auto-refresh when leaving logs
  if (name !== 'logs') stopAutoRefresh();

  if (name === 'dashboard') loadDashboard();
  if (name === 'logs')      loadLogs();
  if (name === 'customers') loadCustomers();
  if (name === 'purchases') loadPurchases();
  if (name === 'support')   loadSupport();
}

function routeFromHash() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  showSection(hash);
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const s = await api('GET', '/api/admin/dashboard');
    document.getElementById('val-total-users').textContent    = s.totalUsers.toLocaleString();
    document.getElementById('val-new-users').textContent      = s.newUsersLast7.toLocaleString();
    document.getElementById('val-total-purchases').textContent = s.totalPurchases.toLocaleString();
    document.getElementById('val-revenue').textContent        = '£' + Number(s.revenueLast30).toFixed(2);

    const container = document.getElementById('recent-warnings');
    if (!s.recentLogWarnings.length) {
      container.innerHTML = '<div class="log-empty">No recent warnings or errors — all clear.</div>';
    } else {
      container.innerHTML = s.recentLogWarnings.map(r => `
        <div class="log-row">
          <span class="log-time">${fmtTime(r.createdAt)}</span>
          <span>${levelBadge(r.level)}</span>
          <span class="badge">${r.category}</span>
          <span>${escHtml(r.message)}</span>
        </div>`).join('');
    }
  } catch (err) {
    toast('Dashboard error: ' + err.message, 'error');
  }
}

// ── Logs ───────────────────────────────────────────────────────────────────────
function getLogsFilters() {
  return {
    q:        document.getElementById('logs-q').value.trim()        || undefined,
    level:    document.getElementById('logs-level').value           || undefined,
    category: document.getElementById('logs-category').value       || undefined,
    from:     document.getElementById('logs-from').value            || undefined,
    to:       document.getElementById('logs-to').value              || undefined
  };
}

async function loadLogs(page = state.logs.page) {
  state.logs.page = page;
  const f = { ...state.logs.filters, page, limit: 50 };
  const qs = buildQS(f);
  try {
    const data = await api('GET', '/api/admin/logs?' + qs);
    renderLogs(data);
  } catch (err) {
    toast('Logs error: ' + err.message, 'error');
  }
}

function renderLogs({ rows, total, page, limit }) {
  const tbody = document.getElementById('logs-tbody');
  document.getElementById('logs-result-count').textContent =
    `Showing ${rows.length} of ${total} log entries`;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">No log entries found</td></tr>';
  } else {
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td style="white-space:nowrap;font-size:.78rem">${fmtTime(r.createdAt)}</td>
        <td>${levelBadge(r.level)}</td>
        <td><span class="badge">${escHtml(r.category)}</span></td>
        <td style="font-size:.82rem">${escHtml(r.message)}</td>
        <td style="font-size:.78rem">${escHtml(r.username || '—')}</td>
      </tr>`).join('');
  }

  renderPagination('logs-pagination', page, limit, total, p => loadLogs(p));
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshInterval = setInterval(() => {
    if (document.getElementById('logs-autorefresh').checked) loadLogs();
  }, 10000);
}
function stopAutoRefresh() {
  clearInterval(autoRefreshInterval);
  autoRefreshInterval = null;
}

async function exportCsv() {
  const f   = { ...state.logs.filters, csv: '1', limit: 500 };
  const qs  = buildQS(f);
  const token = getToken();
  const res = await fetch('/api/admin/logs?' + qs, { headers: authHeaders() });
  if (!res.ok) { toast('Export failed', 'error'); return; }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'app_log.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported', 'ok');
}

// ── Customers ──────────────────────────────────────────────────────────────────
async function loadCustomers(page = state.customers.page) {
  state.customers.page = page;
  const f = { ...state.customers.filters, page, limit: 20 };
  try {
    const data = await api('GET', '/api/admin/customers?' + buildQS(f));
    renderCustomers(data);
  } catch (err) {
    toast('Customers error: ' + err.message, 'error');
  }
}

function renderCustomers({ rows, total, page, limit }) {
  const tbody = document.getElementById('cust-tbody');
  document.getElementById('cust-result-count').textContent = `Showing ${rows.length} of ${total} customers`;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">No customers found</td></tr>';
  } else {
    tbody.innerHTML = rows.map(r => `
      <tr class="clickable" data-id="${r.id}">
        <td>${escHtml(r.firstName + ' ' + r.lastName)}</td>
        <td>${escHtml(r.username)}</td>
        <td>${escHtml(r.customerEmail)}</td>
        <td style="font-size:.78rem">${fmtDate(r.createdAt)}</td>
        <td>${r.purchaseCount}</td>
        <td>${r.suspended ? '<span class="badge badge-suspended">Suspended</span>' : '<span class="badge badge-active">Active</span>'}</td>
      </tr>`).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => openCustomerDetail(Number(tr.dataset.id)));
    });
  }

  renderPagination('cust-pagination', page, limit, total, p => loadCustomers(p));
}

async function openCustomerDetail(id) {
  showLoading(true);
  try {
    const c = await api('GET', '/api/admin/customers/' + id);
    renderCustomerDetail(c);
    document.getElementById('cust-detail-overlay').classList.remove('hidden');
  } catch (err) {
    toast('Error loading customer: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

function renderCustomerDetail(c) {
  document.getElementById('cust-detail-name').textContent = c.firstName + ' ' + c.lastName;
  const body = document.getElementById('cust-detail-body');

  const field = (k, v) => `<div class="detail-field"><span class="detail-key">${k}</span><span class="detail-value">${escHtml(String(v ?? '—'))}</span></div>`;

  const suspended = c.suspended;

  body.innerHTML = `
    <div class="detail-section">
      <h3>Profile</h3>
      ${field('Username',   c.username)}
      ${field('Email',      c.customerEmail)}
      ${field('Phone',      c.phone)}
      ${field('Address',    [c.addressLine1, c.addressLine2, c.city, c.postcode, c.country].filter(Boolean).join(', '))}
      ${field('Joined',     fmtDate(c.createdAt))}
      ${field('Status',     suspended ? 'Suspended' : 'Active')}
      ${field('Role',       c.role)}
      ${field('Purchases',  c.purchaseCount)}
      ${field('Total spent','£' + Number(c.totalSpend || 0).toFixed(2))}
    </div>

    <div class="detail-section">
      <h3>Account actions</h3>
      <div class="detail-actions">
        <button class="btn btn-sm ${suspended ? 'btn-primary' : 'btn-warn'}" id="btn-toggle-suspend" data-id="${c.id}" data-suspended="${suspended ? '1' : '0'}">
          ${suspended ? 'Unsuspend account' : 'Suspend account'}
        </button>
        <button class="btn btn-sm btn-secondary" id="btn-send-reset" data-id="${c.id}">Reset password</button>
        <button class="btn btn-sm btn-danger" id="btn-delete-user" data-id="${c.id}">Delete account</button>
      </div>
    </div>

    ${c.purchases && c.purchases.length ? `
    <div class="detail-section">
      <h3>Purchase history (${c.purchases.length})</h3>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Event</th><th>Qty</th><th>Total</th></tr></thead>
        <tbody>
          ${c.purchases.map(p => `<tr>
            <td style="font-size:.78rem">${fmtDate(p.purchaseDate)}</td>
            <td>${escHtml(p.eventName)}</td>
            <td>${p.quantity}</td>
            <td>£${Number(p.totalPrice).toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    ${c.recentLog && c.recentLog.length ? `
    <div class="detail-section">
      <h3>Recent activity log</h3>
      <div class="log-snippet">
        ${c.recentLog.map(r => `
          <div class="log-row">
            <span style="font-size:.75rem">${fmtTime(r.createdAt)}</span>
            <span>${levelBadge(r.level)}</span>
            <span class="badge">${r.category}</span>
            <span style="font-size:.78rem">${escHtml(r.message)}</span>
          </div>`).join('')}
      </div>
    </div>` : ''}
  `;

  // Wire action buttons
  document.getElementById('btn-toggle-suspend').addEventListener('click', async e => {
    const btn = e.currentTarget;
    try {
      const res = await api('PUT', '/api/admin/customers/' + btn.dataset.id + '/suspend');
      toast(res.suspended ? 'Account suspended' : 'Account unsuspended', 'ok');
      document.getElementById('cust-detail-overlay').classList.add('hidden');
      loadCustomers();
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('btn-send-reset').addEventListener('click', async e => {
    const btn = e.currentTarget;
    if (!confirm('Send a password reset email to this customer?')) return;
    try {
      const res = await api('POST', '/api/admin/customers/' + btn.dataset.id + '/reset-password');
      let msg = 'Reset email sent.';
      if (res.previewUrl) msg += ' Preview: ' + res.previewUrl;
      toast(msg, 'ok');
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('btn-delete-user').addEventListener('click', async e => {
    const btn = e.currentTarget;
    if (!confirm('Permanently delete this customer account and all their data? This cannot be undone.')) return;
    try {
      await api('DELETE', '/api/admin/customers/' + btn.dataset.id);
      toast('Customer deleted', 'ok');
      document.getElementById('cust-detail-overlay').classList.add('hidden');
      loadCustomers();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ── Purchases ──────────────────────────────────────────────────────────────────
async function loadPurchases(page = state.purchases.page) {
  state.purchases.page = page;
  const f = { ...state.purchases.filters, page, limit: 20 };
  try {
    const data = await api('GET', '/api/admin/purchases?' + buildQS(f));
    renderPurchases(data);
  } catch (err) {
    toast('Purchases error: ' + err.message, 'error');
  }
}

function renderPurchases({ rows, total, page, limit }) {
  const tbody = document.getElementById('purch-tbody');
  document.getElementById('purch-result-count').textContent = `Showing ${rows.length} of ${total} purchases`;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">No purchases found</td></tr>';
  } else {
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td style="font-size:.78rem">${fmtDate(r.purchaseDate)}</td>
        <td>${escHtml(r.customerName)}<br><span style="font-size:.74rem;color:var(--text-muted)">${escHtml(r.customerEmail)}</span></td>
        <td>${escHtml(r.eventName)}</td>
        <td>${r.quantity}</td>
        <td>£${Number(r.totalPrice).toFixed(2)}</td>
        <td style="font-size:.78rem">${escHtml(r.cardMasked || '—')}</td>
      </tr>`).join('');
  }

  renderPagination('purch-pagination', page, limit, total, p => loadPurchases(p));
}

// ── Pagination helper ──────────────────────────────────────────────────────────
function renderPagination(containerId, page, limit, total, onPage) {
  const totalPages = Math.ceil(total / limit);
  const container  = document.getElementById(containerId);
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  const mkBtn = (label, p, active = false, disabled = false) => {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (active ? ' active' : '');
    btn.textContent = label;
    btn.disabled    = disabled;
    if (!disabled && !active) btn.addEventListener('click', () => onPage(p));
    return btn;
  };

  container.innerHTML = '';
  container.appendChild(mkBtn('‹ Prev', page - 1, false, page === 1));

  // Show window of page buttons
  const lo = Math.max(1, page - 2);
  const hi = Math.min(totalPages, page + 2);
  for (let i = lo; i <= hi; i++) container.appendChild(mkBtn(i, i, i === page));

  container.appendChild(mkBtn('Next ›', page + 1, false, page === totalPages));
}

// ── Misc helpers ───────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function levelBadge(level) {
  const map = { info: 'badge-info', warn: 'badge-warn', error: 'badge-error', audit: 'badge-audit' };
  return `<span class="badge ${map[level] || ''}">${escHtml(level)}</span>`;
}

function buildQS(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
}

// ── Event listeners ────────────────────────────────────────────────────────────
function bindEvents() {
  // Sidebar nav
  document.querySelectorAll('.nav-item').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const section = a.dataset.section;
      window.location.hash = '#' + section;
    });
  });

  // Hash-based routing
  window.addEventListener('hashchange', routeFromHash);

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    try { await api('POST', '/api/auth/logout'); } catch (_) {}
    sessionStorage.removeItem('authToken');
    window.location.href = '/';
  });

  // ── Logs
  document.getElementById('btn-logs-search').addEventListener('click', () => {
    state.logs.filters = getLogsFilters();
    state.logs.page    = 1;
    loadLogs(1);
  });
  document.getElementById('btn-logs-reset').addEventListener('click', () => {
    ['logs-q','logs-from','logs-to'].forEach(id => document.getElementById(id).value = '');
    ['logs-level','logs-category'].forEach(id => document.getElementById(id).value = '');
    state.logs.filters = {};
    state.logs.page    = 1;
    loadLogs(1);
  });
  document.getElementById('logs-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-logs-search').click();
  });
  document.getElementById('btn-export-csv').addEventListener('click', exportCsv);
  document.getElementById('logs-autorefresh').addEventListener('change', e => {
    if (e.target.checked) startAutoRefresh(); else stopAutoRefresh();
  });

  // ── Customers
  document.getElementById('btn-cust-search').addEventListener('click', () => {
    state.customers.filters = { q: document.getElementById('cust-q').value.trim() || undefined };
    state.customers.page    = 1;
    loadCustomers(1);
  });
  document.getElementById('btn-cust-reset').addEventListener('click', () => {
    document.getElementById('cust-q').value = '';
    state.customers.filters = {};
    state.customers.page    = 1;
    loadCustomers(1);
  });
  document.getElementById('cust-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-cust-search').click();
  });
  document.getElementById('cust-detail-close').addEventListener('click', () => {
    document.getElementById('cust-detail-overlay').classList.add('hidden');
  });
  document.getElementById('cust-detail-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  // ── Purchases
  document.getElementById('btn-purch-search').addEventListener('click', () => {
    state.purchases.filters = {
      q:    document.getElementById('purch-q').value.trim()    || undefined,
      from: document.getElementById('purch-from').value        || undefined,
      to:   document.getElementById('purch-to').value          || undefined
    };
    state.purchases.page = 1;
    loadPurchases(1);
  });
  document.getElementById('btn-purch-reset').addEventListener('click', () => {
    ['purch-q','purch-from','purch-to'].forEach(id => document.getElementById(id).value = '');
    state.purchases.filters = {};
    state.purchases.page    = 1;
    loadPurchases(1);
  });
  document.getElementById('purch-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-purch-search').click();
  });

  // ── Support
  document.getElementById('btn-sup-search').addEventListener('click', () => {
    state.support.filters = {
      q:        document.getElementById('sup-q').value.trim()       || undefined,
      status:   document.getElementById('sup-status').value         || undefined,
      priority: document.getElementById('sup-priority').value       || undefined
    };
    state.support.page = 1;
    loadSupport(1);
  });
  document.getElementById('btn-sup-reset').addEventListener('click', () => {
    ['sup-q'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('sup-status').value   = 'all';
    document.getElementById('sup-priority').value = '';
    state.support.filters = {};
    state.support.page    = 1;
    loadSupport(1);
  });
  document.getElementById('sup-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-sup-search').click();
  });

  document.getElementById('sup-detail-close').addEventListener('click', () => {
    document.getElementById('sup-detail-overlay').classList.add('hidden');
  });
}

// ── Support ────────────────────────────────────────────────────────────────────

const STATUS_COLOURS = { open: '#e53e3e', in_progress: '#dd6b20', resolved: '#38a169', closed: '#718096' };
const PRIORITY_COLOURS = { urgent: '#9b2c2c', high: '#c05621', normal: '#2b6cb0', low: '#555' };

function statusBadge(s) {
  return `<span class="badge" style="background:${STATUS_COLOURS[s]||'#718096'};color:#fff">${s.replace('_',' ')}</span>`;
}
function priorityBadge(p) {
  return `<span class="badge" style="background:${PRIORITY_COLOURS[p]||'#555'};color:#fff">${p}</span>`;
}

async function loadSupport(page) {
  if (page) state.support.page = page;
  try {
    const { q, status, priority } = state.support.filters;
    const params = buildQS({ q, status, priority, page: state.support.page, limit: 20 });
    const result = await api('GET', '/api/admin/support?' + params);

    document.getElementById('sup-result-count').textContent =
      `Showing ${result.rows.length} of ${result.total} ticket${result.total !== 1 ? 's' : ''}`;

    document.getElementById('sup-tbody').innerHTML = result.rows.length
      ? result.rows.map(t => `
        <tr style="cursor:pointer" onclick="renderSupportDetail(${t.id})">
          <td>#${t.id}</td>
          <td>${escHtml(t.displayName || 'Guest')}<br><small style="color:#888">${escHtml(t.displayEmail||'')}</small></td>
          <td>${escHtml(t.subject)}</td>
          <td>${statusBadge(t.status)}</td>
          <td>${priorityBadge(t.priority)}</td>
          <td>${t.messageCount}</td>
          <td>${fmtDate(t.updatedAt)}</td>
        </tr>`).join('')
      : '<tr><td colspan="7" style="text-align:center;color:#999">No tickets found.</td></tr>';

    document.getElementById('sup-pagination').innerHTML =
      renderPagination(result.page, Math.ceil(result.total / result.limit), p => loadSupport(p));
  } catch (err) {
    toast('Support error: ' + err.message, 'error');
  }
}

async function renderSupportDetail(ticketId) {
  const overlay = document.getElementById('sup-detail-overlay');
  const body    = document.getElementById('sup-detail-body');
  document.getElementById('sup-detail-title').textContent = `Ticket #${ticketId}`;
  body.innerHTML = '<p>Loading…</p>';
  overlay.classList.remove('hidden');

  try {
    const ticket = await api('GET', `/api/support/tickets/${ticketId}`);

    const canReply = ticket.status !== 'resolved' && ticket.status !== 'closed';

    body.innerHTML = `
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1rem;align-items:center">
        ${statusBadge(ticket.status)} ${priorityBadge(ticket.priority)}
        <span style="font-size:.8rem;color:#888">Created ${fmtDate(ticket.createdAt)}</span>
      </div>
      <div style="margin-bottom:1.25rem">
        <strong>Customer:</strong> ${escHtml(ticket.username || ticket.guestName || 'Guest')}
        &nbsp;(${escHtml(ticket.userEmail || ticket.guestEmail || '—')})
      </div>

      <div style="margin-bottom:1rem">
        <label style="font-weight:600;display:block;margin-bottom:.25rem">Update status</label>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${['open','in_progress','resolved','closed'].map(s =>
            `<button data-status="${s}" class="btn btn-sm ${ticket.status===s?'btn-primary':'btn-secondary'}"
               onclick="updateTicketStatus(${ticket.id},'${s}')">${s.replace('_',' ')}</button>`
          ).join('')}
        </div>
      </div>

      <div class="support-thread" id="thread-${ticketId}">
        ${(ticket.messages || []).map(m => {
          const isAdmin = m.isAdmin;
          return `<div style="text-align:${isAdmin?'right':'left'};margin:.6rem 0">
            <div style="display:inline-block;max-width:85%;background:${isAdmin?'#eef2ff':'#f7fafc'};border-radius:8px;padding:.5rem .8rem;text-align:left">
              <div style="font-size:.72rem;color:#888;margin-bottom:.2rem">
                ${escHtml(isAdmin ? (m.authorName||'Admin') : (m.authorName||ticket.username||ticket.guestName||'Guest'))}
                &bull; ${fmtTime(m.createdAt)}
              </div>
              <div>${escHtml(m.body).replace(/\n/g,'<br>')}</div>
            </div>
          </div>`;
        }).join('')}
      </div>

      ${canReply ? `
      <form onsubmit="submitAdminReply(event,${ticket.id})" style="margin-top:1rem">
        <textarea id="admin-reply-${ticketId}" rows="3" style="width:100%;padding:.5rem;border:1px solid #ccc;border-radius:4px" placeholder="Type your reply…"></textarea>
        <div id="admin-reply-msg-${ticketId}" style="color:#e53e3e;margin-top:.25rem;font-size:.85rem"></div>
        <button type="submit" class="btn btn-primary btn-sm" style="margin-top:.4rem">Send Reply</button>
      </form>` : `<p style="color:#999;font-style:italic;margin-top:1rem">This ticket is ${ticket.status} — no further replies.</p>`}
    `;
  } catch (err) {
    body.innerHTML = `<p style="color:red">Error: ${escHtml(err.message)}</p>`;
  }
}

async function updateTicketStatus(ticketId, status) {
  try {
    await api('PUT', `/api/admin/support/${ticketId}`, { status });
    toast(`Ticket #${ticketId} marked as ${status.replace('_',' ')}`, 'success');
    renderSupportDetail(ticketId);
    loadSupport();
  } catch (err) {
    toast('Update failed: ' + err.message, 'error');
  }
}

async function submitAdminReply(e, ticketId) {
  e.preventDefault();
  const textarea = document.getElementById(`admin-reply-${ticketId}`);
  const msgEl    = document.getElementById(`admin-reply-msg-${ticketId}`);
  const body     = textarea ? textarea.value.trim() : '';
  if (!body) return;

  try {
    const result = await api('POST', `/api/admin/support/${ticketId}/reply`, { body });
    if (result.previewUrl) {
      toast(`Reply sent. Email preview: ${result.previewUrl}`, 'info');
    } else {
      toast('Reply sent', 'success');
    }
    renderSupportDetail(ticketId);
    loadSupport();
  } catch (err) {
    if (msgEl) msgEl.textContent = err.message;
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────
(async function init() {
  showLoading(true);
  await initAuth();
  bindEvents();
  routeFromHash();
  showLoading(false);
}());
