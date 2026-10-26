const state = {
  token: sessionStorage.getItem("pimToken") || "",
  user: null,
  view: "dashboard",
  medicines: [],
  suppliers: [],
  movements: [],
  report: null,
  medicineQuery: "",
  users: [],
  medicineStatus: "all",
  movementType: "all",
  reportDays: 90,
  authMode: "login"
};

const $ = (selector, root) => (root || document).querySelector(selector);
const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
const content = $("#content");
const modal = $("#modal");
const modalBody = $("#modalBody");

function esc(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function money(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value || 0));
}
function number(value) {
  return new Intl.NumberFormat("en-IN").format(Number(value || 0));
}
function date(value) {
  if (!value) return "—";
  const item = new Date(value);
  if (Number.isNaN(item.getTime())) return "—";
  return item.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function initials(value) {
  return String(value || "A").split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("");
}
function noticeToast(message, type) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = "toast " + (type || "success");
  window.clearTimeout(noticeToast.timer);
  noticeToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 4200);
}
async function api(url, options) {
  const setup = options || {};
  const headers = Object.assign({}, setup.headers || {});
  if (setup.body !== undefined && !(setup.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = "Bearer " + state.token;
  const response = await fetch(url, Object.assign({}, setup, { headers }));
  let data = {};
  try { data = await response.json(); } catch (error) { data = {}; }
  if (!response.ok) {
    if (response.status === 401 && state.token) {
      state.token = "";
      sessionStorage.removeItem("pimToken");
      showAuth(false);
    }
    throw new Error(data.message || "Request failed. Please try again.");
  }
  return data;
}
function showAuth(setupRequired) {
  $("#appShell").classList.add("hidden");
  $("#authScreen").classList.remove("hidden");
  $("#authError").textContent = "";
  $("#authForm").reset();
  state.authMode = setupRequired ? "setup" : "login";
  $("#authTitle").textContent = setupRequired ? "Set up your workspace" : "Welcome back";
  $("#authDescription").textContent = setupRequired
    ? "Create the first administrator account to secure this inventory."
    : "Sign in to manage medicine stock, batches and expiry alerts.";
  $("#authNameWrap").classList.toggle("hidden", !setupRequired);
  $("#authForm [name=name]").required = Boolean(setupRequired);
  $("#authForm [name=password]").autocomplete = setupRequired ? "new-password" : "current-password";
  $("#authHint").textContent = setupRequired
    ? "Use at least 10 characters. Only the first account can be created here."
    : "Your session is protected with signed login tokens.";
  $("#authSubmit").textContent = setupRequired ? "Create administrator account" : "Sign in";
}
function showShell() {
  $("#authScreen").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
  $("#userName").textContent = state.user.name;
  $("#userEmail").textContent = state.user.email;
  $("#userAvatar").textContent = initials(state.user.name);
  const usersNav = $("#usersNavItem");
  if (usersNav) usersNav.classList.toggle("hidden", state.user.role !== "admin");
  $("#todayDate").textContent = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
async function start() {
  try {
    const status = await api("/api/auth/status");
    if (state.token) {
      try {
        const response = await api("/api/auth/me");
        state.user = response.user;
        showShell();
        await loadView(state.view);
        return;
      } catch (error) {
        state.token = "";
        sessionStorage.removeItem("pimToken");
      }
    }
    showAuth(status.setupRequired);
  } catch (error) {
    showAuth(false);
    $("#authError").textContent = "Could not reach the application database. Check deployment configuration and reload.";
  }
}
async function signIn(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = $("#authSubmit");
  const errorBox = $("#authError");
  submit.disabled = true;
  errorBox.textContent = "";
  try {
    const path = state.authMode === "setup" ? "/api/auth/setup" : "/api/auth/login";
    const response = await api(path, { method: "POST", body: JSON.stringify(values) });
    state.token = response.token;
    state.user = response.user;
    sessionStorage.setItem("pimToken", state.token);
    showShell();
    await loadView("dashboard");
  } catch (error) {
    errorBox.textContent = error.message;
    if (state.authMode === "setup" && error.message.toLowerCase().includes("already complete")) showAuth(false);
  } finally {
    submit.disabled = false;
  }
}
function signOut() {
  state.token = "";
  state.user = null;
  sessionStorage.removeItem("pimToken");
  state.view = "dashboard";
  showAuth(false);
}
const viewMeta = {
  dashboard: ["Inventory overview", "A clear picture of stock, expiry and activity."],
  medicines: ["Medicine inventory", "Manage every medicine batch and its stock level."],
  suppliers: ["Suppliers", "Keep supplier contacts and linked medicine batches organised."],
  stock: ["Stock movements", "Record stock in or stock out with a traceable audit entry."],
  reports: ["Inventory reports", "Review expiry exposure, low stock, and stock movement totals."],
  users: ["User management", "Create staff accounts and manage access to this workspace."]
};
async function loadView(view) {
  state.view = view;
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $("#breadcrumbCurrent").textContent = viewMeta[view][0];
  $("#pageTitle").textContent = viewMeta[view][0];
  $("#pageSubtitle").textContent = viewMeta[view][1];
  $("#primaryActionText").textContent = ({ dashboard: "Add medicine", medicines: "Add medicine", suppliers: "Add supplier", stock: "Record movement", reports: "Add medicine", users: "Add user" })[view];
  $("#primaryAction").classList.toggle("hidden", view === "reports" || (view === "users" && state.user?.role !== "admin"));
  content.innerHTML = '<div class="loading-state">Loading your inventory…</div>';
  try {
    if (view === "dashboard") await renderDashboard();
    if (view === "medicines") await renderMedicines();
    if (view === "suppliers") await renderSuppliers();
    if (view === "stock") await renderStock();
    if (view === "reports") await renderReports();
    if (view === "users") await renderUsers();
  } catch (error) {
    content.innerHTML = '<div class="panel empty-state"><strong>Unable to load this section</strong>' + esc(error.message) + '<div style="margin-top:14px"><button class="button button-secondary" data-action="reload">Try again</button></div></div>';
  }
}
function sectionHeading(title, description, actions) {
  return '<div class="section-heading"><div><h2>' + title + '</h2><p>' + description + '</p></div><div class="heading-actions">' + (actions || "") + '</div></div>';
}
function statCard(label, value, detail, symbol, color) {
  return '<article class="stat-card"><div class="stat-top"><span class="stat-label">' + label + '</span><span class="stat-icon ' + (color || "") + '">' + symbol + '</span></div><div class="stat-value">' + value + '</div><div class="stat-detail">' + detail + '</div></article>';
}
function statusBadge(item) {
  const expires = new Date(item.expiryDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 30);
  if (expires < today) return '<span class="badge red">Expired</span>';
  if (expires <= soon) return '<span class="badge amber">Expiring soon</span>';
  if (Number(item.quantity) <= Number(item.reorderLevel)) return '<span class="badge amber">Low stock</span>';
  return '<span class="badge green">In stock</span>';
}
function movementBadge(type) {
  return type === "IN" ? '<span class="badge green">↑ Stock in</span>' : '<span class="badge red">↓ Stock out</span>';
}
function emptyState(title, description) {
  return '<div class="empty-state"><div class="empty-icon">✓</div><strong>' + title + '</strong>' + description + '</div>';
}
function medicineNameCell(item) {
  return '<span class="medicine-main">' + esc(item.name) + '</span><span class="cell-sub">' + esc(item.brand || item.category || "Medicine") + '</span>';
}
function medicineTable(rows, withActions) {
  if (!rows.length) return emptyState("No medicine batches found", "Add your first batch to start tracking inventory.");
  return '<div class="table-wrap"><table class="data-table"><thead><tr><th>MEDICINE / BRAND</th><th>BATCH</th><th>ON HAND</th><th>EXPIRY DATE</th><th>STATUS</th>' + (withActions ? '<th>ACTIONS</th>' : "") + '</tr></thead><tbody>' +
    rows.map((item) => '<tr><td>' + medicineNameCell(item) + '</td><td>' + esc(item.batchNumber) + '</td><td><span class="stock-number">' + number(item.quantity) + '</span><span class="cell-sub">reorder at ' + number(item.reorderLevel) + '</span></td><td>' + date(item.expiryDate) + '</td><td>' + statusBadge(item) + '</td>' +
    (withActions ? '<td><div class="row-actions"><button class="row-action" data-action="edit-medicine" data-id="' + esc(item._id) + '">Edit</button><button class="row-action" data-action="stock-medicine" data-id="' + esc(item._id) + '">Stock</button><button class="row-action danger" data-action="delete-medicine" data-id="' + esc(item._id) + '">Delete</button></div></td>' : "") + '</tr>').join("") +
    '</tbody></table></div>';
}
function movementsTable(rows) {
  if (!rows.length) return emptyState("No stock movements yet", "New receipts and stock-outs will appear here.");
  return '<div class="table-wrap"><table class="data-table"><thead><tr><th>DATE / TIME</th><th>MEDICINE BATCH</th><th>MOVEMENT</th><th>QTY</th><th>BALANCE AFTER</th><th>RECORDED BY</th><th>NOTE</th></tr></thead><tbody>' +
    rows.map((item) => '<tr><td>' + dateTime(item.createdAt) + '</td><td><span class="medicine-main">' + esc(item.medicineName) + '</span><span class="cell-sub">' + esc(item.batchNumber) + '</span></td><td>' + movementBadge(item.type) + '</td><td><strong>' + (item.type === "IN" ? "+" : "−") + number(item.quantity) + '</strong></td><td>' + number(item.balanceAfter) + '</td><td>' + esc(item.performedByName) + '</td><td>' + esc(item.note || item.reference || "—") + '</td></tr>').join("") +
    '</tbody></table></div>';
}
function dateTime(value) {
  if (!value) return "—";
  const item = new Date(value);
  return Number.isNaN(item.getTime()) ? "—" : item.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function warningList(rows, expired) {
  if (!rows.length) return emptyState(expired ? "No expired batches found" : "No upcoming expiry alerts", expired ? "No batch expiry date is in the past." : "No batches expire in this period.");
  return '<ul class="alert-list">' + rows.slice(0, 6).map((item) => '<li><span class="alert-symbol ' + (expired ? "red" : "") + '">' + (expired ? "!" : "◷") + '</span><div class="alert-copy"><strong>' + esc(item.name) + '</strong><small>Batch ' + esc(item.batchNumber) + ' · ' + number(item.quantity) + ' units</small></div><div class="alert-meta">' + date(item.expiryDate) + '</div></li>').join("") + '</ul>';
}
async function renderDashboard() {
  const result = await api("/api/dashboard");
  const s = result.summary;
  $("#medicineNavCount").textContent = number(s.batchCount);
  content.innerHTML =
    '<div class="notice"><span>ⓘ</span><div><strong>Daily stock check</strong> Review expiry warnings and low-stock counts before ordering or issuing stock. These alerts depend on the accuracy of the saved batch data.</div></div>' +
    '<div class="stat-grid">' +
      statCard("Medicine batches", number(s.batchCount), '<span class="detail-highlight">' + number(s.totalUnits) + ' units</span> currently on hand', "▤", "") +
      statCard("Low-stock batches", number(s.lowStockCount), "At or below reorder level", "↧", "amber") +
      statCard("Expiring within 30 days", number(s.expiringSoonCount), "Review batch dates and quantities", "◷", "amber") +
      statCard("Inventory at cost", money(s.inventoryValue), "Purchase price × available stock", "₹", "") +
    '</div>' +
    '<div class="two-column">' +
      '<section class="panel"><div class="panel-header"><div><h2>Expiry watch</h2><p>Expired and upcoming batch dates</p></div><button class="text-link" data-view="reports">All reports →</button></div>' +
      (s.expiredCount ? '<div class="notice red-notice" style="margin:12px 12px 0"><span>!</span><div><strong>' + number(s.expiredCount) + ' expired batch(es)</strong> Verify and quarantine these items; do not issue expired stock.</div></div>' : "") +
      warningList(result.expired, true) +
      '<div class="panel-header subpanel-header"><div><h2>Expiring soon</h2><p>Within the next 30 days</p></div></div>' + warningList(result.expiringSoon, false) + '</section>' +
      '<section class="panel"><div class="panel-header"><div><h2>Low-stock watchlist</h2><p>Items at or below their reorder threshold</p></div><button class="text-link" data-view="medicines">View inventory →</button></div>' +
      (result.lowStock.length ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>MEDICINE</th><th>ON HAND</th><th>REORDER AT</th></tr></thead><tbody>' + result.lowStock.map((item) => '<tr><td>' + medicineNameCell(item) + '</td><td><span class="badge amber">' + number(item.quantity) + '</span></td><td>' + number(item.reorderLevel) + '</td></tr>').join("") + '</tbody></table></div>' : emptyState("Stock levels look good", "No batch is currently below its reorder level.")) +
      '</section></div>' +
    '<section class="panel"><div class="panel-header"><div><h2>Recent stock movements</h2><p>Most recent receipts and stock-outs recorded in PIM</p></div><button class="text-link" data-view="stock">View movement history →</button></div>' +
    movementsTable(result.recentMovements) + '</section>';
}
async function renderMedicines() {
  const params = new URLSearchParams();
  if (state.medicineQuery) params.set("q", state.medicineQuery);
  if (state.medicineStatus !== "all") params.set("status", state.medicineStatus);
  const result = await api("/api/medicines?" + params.toString());
  state.medicines = result.medicines;
  $("#medicineNavCount").textContent = number(result.medicines.length);
  const actions = '<button class="button button-secondary" id="exportMedicines">Export CSV</button>';
  content.innerHTML = sectionHeading("Medicine batches", "Each row is a separate batch with its own expiry date and balance.", actions) +
    '<section class="panel"><form id="medicineSearchForm" class="filter-bar"><div class="search-box"><input name="q" id="medicineSearch" value="' + esc(state.medicineQuery) + '" placeholder="Search medicine, brand, batch or barcode"></div>' +
    '<select id="medicineStatus" aria-label="Filter stock status"><option value="all"' + selected(state.medicineStatus, "all") + '>All batches</option><option value="low"' + selected(state.medicineStatus, "low") + '>Low stock</option><option value="expiring"' + selected(state.medicineStatus, "expiring") + '>Expiring in 30 days</option><option value="expired"' + selected(state.medicineStatus, "expired") + '>Expired</option></select>' +
    '<button class="button button-secondary" type="submit">Search</button><button class="button button-secondary" type="button" id="clearMedicineFilters">Clear</button></form>' + medicineTable(result.medicines, true) + '</section>';
}
function selected(value, expected) { return value === expected ? " selected" : ""; }
async function renderSuppliers() {
  const result = await api("/api/suppliers");
  state.suppliers = result.suppliers;
  content.innerHTML = sectionHeading("Supplier directory", "Keep purchasing contacts in one place.", '<button class="button button-secondary" id="exportSuppliers">Export CSV</button>') +
    '<section class="panel">' + (result.suppliers.length ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>SUPPLIER</th><th>CONTACT PERSON</th><th>PHONE</th><th>EMAIL</th><th>ADDRESS</th><th>ACTIONS</th></tr></thead><tbody>' +
    result.suppliers.map((item) => '<tr><td><span class="medicine-main">' + esc(item.name) + '</span><span class="cell-sub">' + esc(item.notes || "Supplier") + '</span></td><td>' + esc(item.contactPerson || "—") + '</td><td>' + esc(item.phone || "—") + '</td><td>' + esc(item.email || "—") + '</td><td>' + esc(item.address || "—") + '</td><td><div class="row-actions"><button class="row-action" data-action="edit-supplier" data-id="' + esc(item._id) + '">Edit</button><button class="row-action danger" data-action="delete-supplier" data-id="' + esc(item._id) + '">Delete</button></div></td></tr>').join("") +
    '</tbody></table></div>' : emptyState("No suppliers added", "Add a supplier so each medicine batch can be linked to its source.")) + '</section>';
}
async function renderStock() {
  const [movementsResult, medicinesResult] = await Promise.all([
    api("/api/stock/movements" + (state.movementType === "all" ? "" : "?type=" + state.movementType)),
    api("/api/medicines")
  ]);
  state.movements = movementsResult.movements;
  state.medicines = medicinesResult.medicines;
  content.innerHTML = sectionHeading("Stock movement history", "Each receipt and stock-out is recorded with its resulting balance.", '<button class="button button-secondary" id="exportMovements">Export CSV</button>') +
    '<section class="panel"><div class="filter-bar"><label for="movementFilter" class="help-text">Show</label><select id="movementFilter"><option value="all"' + selected(state.movementType, "all") + '>All movement types</option><option value="IN"' + selected(state.movementType, "IN") + '>Stock in</option><option value="OUT"' + selected(state.movementType, "OUT") + '>Stock out</option></select><span class="help-text">Showing the latest ' + number(state.movements.length) + ' records (maximum 200).</span></div>' +
    movementsTable(state.movements) + '</section>';
}
async function renderUsers() {
  if (state.user?.role !== "admin") {
    content.innerHTML = '<div class="panel empty-state"><strong>Administrator access required</strong>Only an administrator can manage user accounts.</div>';
    return;
  }
  const response = await api("/api/users");
  state.users = response.users;
  const rows = state.users.map((user) => '<tr><td><span class="medicine-main">' + esc(user.name) + '</span><span class="cell-sub">' + esc(user.email) + '</span></td><td><span class="badge ' + (user.role === "admin" ? "green" : "amber") + '">' + esc(user.role) + '</span></td><td><span class="badge ' + (user.active ? "green" : "red") + '">' + (user.active ? "Active" : "Inactive") + '</span></td><td>' + date(user.createdAt) + '</td><td><div class="row-actions"><button class="row-action" data-action="edit-user" data-id="' + esc(user._id) + '">Edit</button>' + (user._id === state.user.id ? '' : '<button class="row-action ' + (user.active ? "danger" : "") + '" data-action="toggle-user" data-id="' + esc(user._id) + '">' + (user.active ? "Deactivate" : "Activate") + '</button>') + '</div></td></tr>').join("");
  content.innerHTML = sectionHeading("Team accounts", "Only administrators can create accounts, change roles, reset passwords, or deactivate users.") +
    '<section class="panel"><div class="panel-header"><div><h2>Users</h2><p>' + number(state.users.length) + ' account(s)</p></div></div>' +
    (state.users.length ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>USER</th><th>ROLE</th><th>STATUS</th><th>CREATED</th><th>ACTIONS</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : emptyState("No users found", "Create the first staff account.")) + '</section>';
}
function openUserModal(id) {
  const user = id ? state.users.find((item) => item._id === id) : null;
  const form = '<form data-kind="user" data-id="' + esc(user ? user._id : "") + '">' +
    '<div class="form-grid">' +
    makeField("Full name", "name", user ? user.name : "", "text", true, "", "Staff member name") +
    (user ? '<label class="field">Email address<input type="email" value="' + esc(user.email) + '" disabled></label>' : makeField("Email address", "email", "", "email", true, "", "name@pharmacy.com")) +
    (!user ? makeField("Temporary password", "password", "", "password", true, "", "At least 10 characters") : '<label class="field"><span>Reset password (optional)</span><input name="password" type="password" minlength="10" placeholder="Leave blank to keep current password"></label>') +
    makeSelect("Role", "role", [{value:"staff",label:"Staff"},{value:"admin",label:"Administrator"}], user ? user.role : "staff", true) +
    '</div><p class="help-text">Accounts are created by an administrator; public self-registration is disabled. Share temporary passwords securely.</p>' +
    formFooter() + '</form>';
  openModal(user ? "Edit user account" : "Create staff account", form);
}
async function renderReports() {
  const report = await api("/api/reports?days=" + state.reportDays);
  state.report = report;
  content.innerHTML = sectionHeading("Inventory reports", "Use these summaries to plan a stock check and replenishment.", '<button class="button button-secondary" id="exportReport">Export warnings CSV</button>') +
    '<div class="filter-bar"><label for="reportDays" class="help-text">Expiry window</label><select id="reportDays"><option value="30"' + selected(String(state.reportDays), "30") + '>Next 30 days</option><option value="60"' + selected(String(state.reportDays), "60") + '>Next 60 days</option><option value="90"' + selected(String(state.reportDays), "90") + '>Next 90 days</option><option value="180"' + selected(String(state.reportDays), "180") + '>Next 180 days</option><option value="365"' + selected(String(state.reportDays), "365") + '>Next 365 days</option></select></div>' +
    '<div class="report-grid">' +
      '<div class="report-metric"><span>Units on hand</span><strong>' + number(report.summary.unitsOnHand) + '</strong></div>' +
      '<div class="report-metric"><span>Expired batches</span><strong>' + number(report.summary.expiredCount) + '</strong></div>' +
      '<div class="report-metric"><span>Expiring in window</span><strong>' + number(report.summary.expiringCount) + '</strong></div>' +
      '<div class="report-metric"><span>Low-stock batches</span><strong>' + number(report.summary.lowStockCount) + '</strong></div>' +
      '<div class="report-metric"><span>Inventory at cost</span><strong>' + money(report.summary.inventoryValue) + '</strong></div>' +
      '<div class="report-metric"><span>Received / stock-out in 30d</span><strong>' + number(report.summary.receivedLast30Days) + ' / ' + number(report.summary.sentOutLast30Days) + '</strong></div>' +
    '</div>' +
    '<div class="two-column"><section class="panel"><div class="panel-header"><div><h2>Expired stock</h2><p>Needs immediate manual review</p></div><span class="badge red">' + number(report.expired.length) + ' batches</span></div>' + medicineTable(report.expired, false) + '</section>' +
    '<section class="panel"><div class="panel-header"><div><h2>Expiry window</h2><p>Expires within ' + number(state.reportDays) + ' days</p></div><span class="badge amber">' + number(report.expiring.length) + ' batches</span></div>' + medicineTable(report.expiring, false) + '</section></div>' +
    '<section class="panel"><div class="panel-header"><div><h2>Reorder review</h2><p>Quantity is at or below the saved reorder threshold</p></div></div>' + medicineTable(report.lowStock, false) + '</section>';
}
function makeField(label, name, value, type, required, extraClass, placeholder) {
  const controlType = type || "text";
  const cls = extraClass ? " " + extraClass : "";
  const req = required ? " required" : "";
  const hint = controlType === "textarea"
    ? '<textarea name="' + esc(name) + '" rows="3" placeholder="' + esc(placeholder || "") + '"' + req + '>' + esc(value) + '</textarea>'
    : '<input name="' + esc(name) + '" type="' + esc(controlType) + '" value="' + esc(value) + '" placeholder="' + esc(placeholder || "") + '"' + req + '>';
  return '<label class="field' + cls + '">' + label + hint + '</label>';
}
function makeSelect(label, name, options, value, required, extraClass) {
  return '<label class="field' + (extraClass ? " " + extraClass : "") + '">' + label + '<select name="' + esc(name) + '"' + (required ? " required" : "") + '>' + options.map((item) => '<option value="' + esc(item.value) + '"' + selected(String(value || ""), String(item.value)) + '>' + esc(item.label) + '</option>').join("") + '</select></label>';
}
function formFooter() {
  return '<div class="form-error" data-form-error role="alert"></div><div class="form-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Save changes</button></div>';
}
function openModal(title, body) {
  $("#modalTitle").textContent = title;
  modalBody.innerHTML = body;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  const first = $("input:not([type=hidden]), select, textarea", modalBody);
  if (first) window.setTimeout(() => first.focus(), 50);
}
function closeModal() {
  stopBarcodeCamera();
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

let barcodeScanner = null;
let scannerStarting = false;
let lastScannedBarcode = "";

async function stopBarcodeCamera() {
  const active = barcodeScanner;
  barcodeScanner = null;
  if (active) {
    try {
      const status = active.getState ? active.getState() : 0;
      if (status === 2 || status === 1) await active.stop();
    } catch (error) {
      // The scanner may already have stopped after a successful decode.
    }
    try { active.clear(); } catch (error) {}
  }
  scannerStarting = false;
}

function scannerMarkup() {
  return '<div class="scanner-layout">' +
    '<div class="scanner-frame"><div id="scannerReader" aria-label="Camera barcode scanner"></div></div>' +
    '<p id="scannerStatus" class="scanner-status" role="status">Allow camera access, then hold the medicine barcode inside the frame.</p>' +
    '<div class="scanner-manual"><label class="field" for="scannerCodeInput">Or enter / scan barcode manually<input id="scannerCodeInput" autocomplete="off" inputmode="numeric" placeholder="Scan with a USB scanner or type barcode"></label>' +
    '<button class="button button-primary" type="button" data-action="scanner-search">Find medicine</button></div>' +
    '<p class="help-text">Works with common EAN / UPC / Code 128 barcodes. A USB barcode scanner can also type into the field above.</p>' +
    '<div id="scannerResults" class="scanner-results"></div>' +
    '</div>';
}

async function openBarcodeScanner() {
  await stopBarcodeCamera();
  lastScannedBarcode = "";
  openModal("Scan medicine barcode", scannerMarkup());
  const status = $("#scannerStatus");
  if (!window.isSecureContext && location.hostname !== "localhost") {
    status.textContent = "Camera scanning requires a secure HTTPS connection. You can still enter or scan the barcode manually.";
    return;
  }
  if (!window.Html5Qrcode) {
    status.textContent = "The camera scanner library could not load. Use manual entry, or reload the page to try again.";
    return;
  }
  scannerStarting = true;
  const formats = [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.ITF,
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.DATA_MATRIX
  ].filter((value) => value !== undefined);
  barcodeScanner = new Html5Qrcode("scannerReader", { formatsToSupport: formats, verbose: false });
  try {
    await barcodeScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 150 }, aspectRatio: 1.6 },
      async (decodedText) => {
        const code = String(decodedText || "").trim();
        if (!code || code === lastScannedBarcode || modal.classList.contains("hidden")) return;
        lastScannedBarcode = code;
        const input = $("#scannerCodeInput");
        if (input) input.value = code;
        const message = $("#scannerStatus");
        if (message) message.textContent = "Barcode captured: " + code + ". Looking up the inventory…";
        await stopBarcodeCamera();
        await searchScannedBarcode(code);
      },
      () => {}
    );
    scannerStarting = false;
    const reader = $("#scannerReader");
    if (reader) reader.classList.add("scanner-active");
  } catch (error) {
    scannerStarting = false;
    const message = $("#scannerStatus");
    if (message) message.textContent = "Camera could not start. Check browser camera permission, or use manual barcode entry.";
    await stopBarcodeCamera();
  }
}

async function searchScannedBarcode(rawCode) {
  const code = String(rawCode || "").trim();
  if (!code) {
    noticeToast("Scan or enter a barcode first.", "error");
    return;
  }
  lastScannedBarcode = code;
  const status = $("#scannerStatus");
  const results = $("#scannerResults");
  if (status) status.textContent = "Searching inventory for " + code + "…";
  if (results) results.innerHTML = '<div class="loading-state">Looking up barcode…</div>';
  try {
    const response = await api("/api/medicines?q=" + encodeURIComponent(code));
    const medicines = Array.isArray(response.medicines) ? response.medicines : [];
    state.medicines = medicines;
    const exact = medicines.filter((item) => String(item.barcode || "").trim().toLowerCase() === code.toLowerCase());
    const matches = exact.length ? exact : medicines;
    if (status) status.textContent = matches.length
      ? "Found " + matches.length + " matching batch(es) for barcode " + code + "."
      : "No matching batch was found for barcode " + code + ".";
    if (results) {
      results.innerHTML = matches.length
        ? '<div class="scanner-match-list">' + matches.slice(0, 12).map((item) =>
            '<article class="scanner-match"><div class="scanner-match-copy"><strong>' + esc(item.name) + '</strong><span>' + esc(item.brand || item.category || "Medicine") + ' · Batch ' + esc(item.batchNumber) + '</span><small>Barcode ' + esc(item.barcode || "not recorded") + ' · ' + number(item.quantity) + ' units · Expires ' + date(item.expiryDate) + '</small></div><div class="scanner-match-actions"><button type="button" class="button button-secondary button-sm" data-action="scanner-edit" data-id="' + esc(item._id) + '">Edit</button><button type="button" class="button button-primary button-sm" data-action="scanner-stock" data-id="' + esc(item._id) + '">Stock</button></div></article>'
          ).join("") + '</div>'
        : '<div class="scanner-no-match"><strong>No medicine found</strong><p>Add this barcode to a medicine batch so future scans can find it.</p><button type="button" class="button button-primary" data-action="scanner-add" data-code="' + esc(code) + '">Add medicine with this barcode</button></div>';
    }
  } catch (error) {
    if (status) status.textContent = "The inventory lookup failed. Check your connection and try again.";
    if (results) results.innerHTML = '<div class="form-error">' + esc(error.message) + '</div>';
  }
}

async function openMedicineModal(id, scannedBarcode) {
  const old = id ? state.medicines.find((item) => item._id === id) : null;
  const suppliersResult = await api("/api/suppliers");
  state.suppliers = suppliersResult.suppliers;
  const supplierOptions = [{ value: "", label: "No supplier selected" }].concat(state.suppliers.map((item) => ({ value: item._id, label: item.name })));
  const item = old || { name: "", brand: "", category: "General", batchNumber: "", barcode: scannedBarcode || "", manufacturer: "", supplierId: "", purchasePrice: "0", sellingPrice: "0", quantity: "0", reorderLevel: "10", expiryDate: "", storageLocation: "", notes: "" };
  const d = item.expiryDate ? String(item.expiryDate).slice(0, 10) : "";
  const form =
    '<form data-kind="medicine" data-id="' + esc(id || "") + '" class="form-stack">' +
    '<div class="form-grid">' +
    makeField("Medicine name *", "name", item.name, "text", true) +
    makeField("Brand", "brand", item.brand, "text", false) +
    makeField("Category", "category", item.category, "text", false, "", "e.g. Tablet, Syrup, First aid") +
    makeField("Batch number *", "batchNumber", item.batchNumber, "text", true) +
    makeField("Barcode / SKU", "barcode", item.barcode, "text", false) +
    makeField("Manufacturer", "manufacturer", item.manufacturer, "text", false) +
    makeSelect("Supplier", "supplierId", supplierOptions, item.supplierId && item.supplierId._id ? item.supplierId._id : item.supplierId, false) +
    makeField("Expiry date *", "expiryDate", d, "date", true) +
    makeField("Purchase price (₹)", "purchasePrice", item.purchasePrice, "number", true) +
    makeField("Selling price (₹)", "sellingPrice", item.sellingPrice, "number", true) +
    (old ? '<div class="field"><span>Current quantity</span><div class="field-control">' + number(item.quantity) + ' units</div><small>Change stock using a recorded stock movement.</small></div>' : makeField("Opening quantity", "quantity", item.quantity, "number", true)) +
    makeField("Reorder level (units)", "reorderLevel", item.reorderLevel, "number", true) +
    makeField("Storage location", "storageLocation", item.storageLocation, "text", false, "full", "e.g. Shelf A2") +
    makeField("Notes", "notes", item.notes, "textarea", false, "full", "Optional batch or storage notes") +
    '</div>' + (old ? '<p class="help-text">Inventory quantity is changed only through Stock movements so the audit history remains clear.</p>' : '<p class="help-text">The opening quantity will be recorded as an initial stock-in movement.</p>') +
    formFooter() + '</form>';
  openModal(old ? "Edit medicine batch" : "Add medicine batch", form);
}
function openSupplierModal(id) {
  const item = id ? state.suppliers.find((supplier) => supplier._id === id) : null;
  const supplier = item || { name: "", contactPerson: "", phone: "", email: "", address: "", notes: "" };
  const form = '<form data-kind="supplier" data-id="' + esc(id || "") + '" class="form-stack"><div class="form-grid">' +
    makeField("Supplier name *", "name", supplier.name, "text", true) +
    makeField("Contact person", "contactPerson", supplier.contactPerson, "text", false) +
    makeField("Phone", "phone", supplier.phone, "tel", false) +
    makeField("Email", "email", supplier.email, "email", false) +
    makeField("Address", "address", supplier.address, "text", false, "full") +
    makeField("Notes", "notes", supplier.notes, "textarea", false, "full") +
    '</div>' + formFooter() + '</form>';
  openModal(item ? "Edit supplier" : "Add supplier", form);
}
async function openMovementModal(medicineId) {
  const result = state.medicines.length ? { medicines: state.medicines } : await api("/api/medicines");
  state.medicines = result.medicines;
  const options = result.medicines.map((item) => ({
    value: item._id,
    label: item.name + " · " + item.batchNumber + " (" + number(item.quantity) + " units)"
  }));
  if (!options.length) {
    openModal("Record stock movement", emptyState("No medicine batches yet", "Add a medicine batch first, then record its stock movement."));
    return;
  }
  const form = '<form data-kind="movement" class="form-stack"><div class="form-grid">' +
    makeSelect("Medicine batch *", "medicineId", options, medicineId || options[0].value, true, "full") +
    makeSelect("Movement type *", "type", [{ value: "IN", label: "Stock in / received" }, { value: "OUT", label: "Stock out / dispensed" }], "IN", true) +
    makeField("Quantity *", "quantity", "1", "number", true) +
    makeField("Reference (optional)", "reference", "", "text", false, "", "Invoice or internal reference") +
    makeField("Note / reason", "note", "", "text", false, "full", "e.g. Supplier delivery or stock issue") +
    '</div><p class="help-text">Stock-out is blocked when the batch is expired or the available quantity is insufficient.</p>' + formFooter() + '</form>';
  openModal("Record stock movement", form);
}
function downloadCsv(rows, columns, filename) {
  const quote = (value) => '"' + String(value === null || value === undefined ? "" : value).replace(/"/g, '""') + '"';
  const lines = [columns.map((col) => quote(col.label)).join(",")].concat(rows.map((row) => columns.map((col) => {
    let value = row[col.key];
    if (col.key === "expiryDate" || col.key === "createdAt") value = value ? new Date(value).toISOString() : "";
    if (col.key === "supplierId" && value && value.name) value = value.name;
    if (typeof value === "object" && value !== null) value = JSON.stringify(value);
    return quote(value);
  }).join(",")));
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function exportMedicines() {
  downloadCsv(state.medicines, [
    { key: "name", label: "Medicine" }, { key: "brand", label: "Brand" }, { key: "category", label: "Category" },
    { key: "batchNumber", label: "Batch" }, { key: "barcode", label: "Barcode" }, { key: "quantity", label: "Quantity" },
    { key: "reorderLevel", label: "Reorder level" }, { key: "purchasePrice", label: "Purchase price INR" },
    { key: "sellingPrice", label: "Selling price INR" }, { key: "expiryDate", label: "Expiry date" }, { key: "storageLocation", label: "Location" }
  ], "pim-medicine-batches.csv");
}
async function submitModal(event) {
  const form = event.target.closest("form[data-kind]");
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.kind;
  const id = form.dataset.id;
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = $('button[type="submit"]', form);
  const errorBox = $("[data-form-error]", form);
  if (submit) submit.disabled = true;
  if (errorBox) errorBox.textContent = "";
  try {
    let endpoint = "";
    let method = "POST";
    if (kind === "medicine") {
      endpoint = id ? "/api/medicines/" + encodeURIComponent(id) : "/api/medicines";
      method = id ? "PUT" : "POST";
      ["purchasePrice", "sellingPrice"].forEach((key) => { values[key] = Number(values[key]); });
      values.reorderLevel = Number(values.reorderLevel);
      if (!id) values.quantity = Number(values.quantity);
      if (!values.supplierId) values.supplierId = "";
    } else if (kind === "supplier") {
      endpoint = id ? "/api/suppliers/" + encodeURIComponent(id) : "/api/suppliers";
      method = id ? "PUT" : "POST";
    } else if (kind === "movement") {
      endpoint = "/api/stock/movements";
      values.quantity = Number(values.quantity);
    } else if (kind === "user") {
      if (!id && !values.password) throw new Error("Enter a temporary password.");
      if (id && !values.password) delete values.password;
      endpoint = id ? "/api/users/" + encodeURIComponent(id) : "/api/users";
      method = id ? "PATCH" : "POST";
    } else {
      throw new Error("Unsupported form.");
    }
    await api(endpoint, { method, body: JSON.stringify(values) });
    closeModal();
    noticeToast(kind === "movement" ? "Stock movement saved." : kind === "supplier" ? "Supplier saved." : kind === "user" ? "User account saved." : "Medicine batch saved.", "success");
    await loadView(state.view);
  } catch (error) {
    if (errorBox) errorBox.textContent = error.message;
    else noticeToast(error.message, "error");
  } finally {
    if (submit) submit.disabled = false;
  }
}
async function handleAction(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === "close-modal") return closeModal();
  if (action === "scanner-search") return searchScannedBarcode($("#scannerCodeInput")?.value || "");
  if (action === "scanner-add") { const code = button.dataset.code || lastScannedBarcode; closeModal(); return openMedicineModal(null, code); }
  if (action === "scanner-edit") { closeModal(); return openMedicineModal(id); }
  if (action === "scanner-stock") { closeModal(); return openMovementModal(id); }
  if (action === "reload") return loadView(state.view);
  if (action === "edit-medicine") return openMedicineModal(id);
  if (action === "stock-medicine") return openMovementModal(id);
  if (action === "edit-supplier") return openSupplierModal(id);
  if (action === "edit-user") return openUserModal(id);
  if (action === "toggle-user") {
    const user = state.users.find((item) => item._id === id);
    if (!user) return;
    const nextActive = !user.active;
    if (!window.confirm("Are you sure you want to " + (nextActive ? "activate " : "deactivate ") + user.name + "?")) return;
    try {
      await api("/api/users/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ active: nextActive }) });
      noticeToast("User account updated.", "success");
      await loadView("users");
    } catch (error) { noticeToast(error.message, "error"); }
  }
  if (action === "delete-medicine") {
    const item = state.medicines.find((medicine) => medicine._id === id);
    if (!window.confirm("Delete medicine batch " + (item ? item.name + " / " + item.batchNumber : "") + "? This is allowed only if its quantity is zero and no movement history exists.")) return;
    try { await api("/api/medicines/" + encodeURIComponent(id), { method: "DELETE" }); noticeToast("Medicine batch deleted.", "success"); await loadView(state.view); }
    catch (error) { noticeToast(error.message, "error"); }
  }
  if (action === "delete-supplier") {
    const item = state.suppliers.find((supplier) => supplier._id === id);
    if (!window.confirm("Delete supplier " + (item ? item.name : "") + "? Linked batches must be updated first.")) return;
    try { await api("/api/suppliers/" + encodeURIComponent(id), { method: "DELETE" }); noticeToast("Supplier deleted.", "success"); await loadView(state.view); }
    catch (error) { noticeToast(error.message, "error"); }
  }
}
function safeClickActions(event) {
  const button = event.target.closest("[data-action]");
  if (button) {
    handleAction(button).catch((error) => noticeToast(error.message, "error"));
    return;
  }
  const nav = event.target.closest("[data-view]");
  if (nav && !nav.classList.contains("nav-item")) loadView(nav.dataset.view).catch((error) => noticeToast(error.message, "error"));
}
$("#authForm").addEventListener("submit", signIn);
$("#logoutButton").addEventListener("click", signOut);
$("#scannerButton").addEventListener("click", () => openBarcodeScanner().catch((error) => noticeToast(error.message, "error")));
$("#primaryAction").addEventListener("click", () => {
  const action = state.view === "users" ? openUserModal() : state.view === "suppliers" ? openSupplierModal() : state.view === "stock" ? openMovementModal() : openMedicineModal();
  Promise.resolve(action).catch((error) => noticeToast(error.message, "error"));
});
$$(".nav-item").forEach((item) => item.addEventListener("click", () => loadView(item.dataset.view).catch((error) => noticeToast(error.message, "error"))));
modalBody.addEventListener("submit", submitModal);
modalBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) handleAction(button).catch((error) => noticeToast(error.message, "error"));
});
modal.addEventListener("click", (event) => {
  if (event.target.id === "modalBackdrop" || event.target.id === "modalClose") closeModal();
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.classList.contains("hidden")) closeModal(); });
content.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "exportMedicines") return exportMedicines();
  if (button.id === "exportSuppliers") return downloadCsv(state.suppliers, [
    { key: "name", label: "Supplier" }, { key: "contactPerson", label: "Contact person" }, { key: "phone", label: "Phone" },
    { key: "email", label: "Email" }, { key: "address", label: "Address" }, { key: "notes", label: "Notes" }
  ], "pim-suppliers.csv");
  if (button.id === "exportMovements") return downloadCsv(state.movements, [
    { key: "createdAt", label: "Date / time" }, { key: "medicineName", label: "Medicine" }, { key: "batchNumber", label: "Batch" },
    { key: "type", label: "Type" }, { key: "quantity", label: "Quantity" }, { key: "balanceAfter", label: "Balance after" },
    { key: "performedByName", label: "Recorded by" }, { key: "note", label: "Note" }, { key: "reference", label: "Reference" }
  ], "pim-stock-movements.csv");
  if (button.id === "exportReport" && state.report) {
    const rows = state.report.expired.map((item) => Object.assign({ alert: "Expired" }, item))
      .concat(state.report.expiring.map((item) => Object.assign({ alert: "Expiring soon" }, item)))
      .concat(state.report.lowStock.map((item) => Object.assign({ alert: "Low stock" }, item)));
    return downloadCsv(rows, [{ key: "alert", label: "Alert" }, { key: "name", label: "Medicine" }, { key: "batchNumber", label: "Batch" }, { key: "quantity", label: "Quantity" }, { key: "reorderLevel", label: "Reorder level" }, { key: "expiryDate", label: "Expiry date" }], "pim-inventory-warnings.csv");
  }
  if (button.id === "clearMedicineFilters") {
    state.medicineQuery = "";
    state.medicineStatus = "all";
    loadView("medicines").catch((error) => noticeToast(error.message, "error"));
  }
  if (button.classList.contains("nav-item") || button.closest(".nav-item")) return;
  safeClickActions(event);
});
content.addEventListener("submit", (event) => {
  if (event.target.id === "medicineSearchForm") {
    event.preventDefault();
    state.medicineQuery = $("#medicineSearch").value.trim();
    state.medicineStatus = $("#medicineStatus").value;
    loadView("medicines").catch((error) => noticeToast(error.message, "error"));
  }
});
content.addEventListener("change", (event) => {
  if (event.target.id === "medicineStatus") {
    state.medicineStatus = event.target.value;
    state.medicineQuery = $("#medicineSearch").value.trim();
    loadView("medicines").catch((error) => noticeToast(error.message, "error"));
  }
  if (event.target.id === "movementFilter") {
    state.movementType = event.target.value;
    loadView("stock").catch((error) => noticeToast(error.message, "error"));
  }
  if (event.target.id === "reportDays") {
    state.reportDays = Number(event.target.value);
    loadView("reports").catch((error) => noticeToast(error.message, "error"));
  }
});
start();
