const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required in production.");
}
const JWT_SECRET = process.env.JWT_SECRET || "local-development-only-change-this-secret";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "100kb" }));

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["admin", "staff"], default: "admin" },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const SupplierSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 150 },
  contactPerson: { type: String, trim: true, default: "", maxlength: 100 },
  phone: { type: String, trim: true, default: "", maxlength: 30 },
  email: { type: String, trim: true, lowercase: true, default: "", maxlength: 150 },
  address: { type: String, trim: true, default: "", maxlength: 500 },
  notes: { type: String, trim: true, default: "", maxlength: 1000 }
}, { timestamps: true });

const MedicineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  brand: { type: String, trim: true, default: "", maxlength: 100 },
  category: { type: String, trim: true, default: "General", maxlength: 80 },
  batchNumber: { type: String, required: true, trim: true, maxlength: 80 },
  barcode: { type: String, trim: true, default: "", maxlength: 100 },
  manufacturer: { type: String, trim: true, default: "", maxlength: 150 },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null },
  purchasePrice: { type: Number, required: true, min: 0, default: 0 },
  sellingPrice: { type: Number, required: true, min: 0, default: 0 },
  quantity: { type: Number, required: true, min: 0, default: 0 },
  reorderLevel: { type: Number, required: true, min: 0, default: 10 },
  expiryDate: { type: Date, required: true },
  storageLocation: { type: String, trim: true, default: "", maxlength: 100 },
  notes: { type: String, trim: true, default: "", maxlength: 1000 }
}, { timestamps: true });

MedicineSchema.index({ name: 1, batchNumber: 1 }, { unique: true });
MedicineSchema.index({ expiryDate: 1 });
MedicineSchema.index({ quantity: 1, reorderLevel: 1 });

const MovementSchema = new mongoose.Schema({
  medicineId: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true, index: true },
  medicineName: { type: String, required: true },
  batchNumber: { type: String, required: true },
  type: { type: String, enum: ["IN", "OUT"], required: true },
  quantity: { type: Number, required: true, min: 1 },
  balanceAfter: { type: Number, required: true, min: 0 },
  note: { type: String, trim: true, default: "", maxlength: 300 },
  reference: { type: String, trim: true, default: "", maxlength: 100 },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  performedByName: { type: String, required: true }
}, { timestamps: true });

MovementSchema.index({ createdAt: -1 });
const User = mongoose.models.User || mongoose.model("User", UserSchema);
const Supplier = mongoose.models.Supplier || mongoose.model("Supplier", SupplierSchema);
const Medicine = mongoose.models.Medicine || mongoose.model("Medicine", MedicineSchema);
const StockMovement = mongoose.models.StockMovement || mongoose.model("StockMovement", MovementSchema);

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/setup", authLimiter);

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return sendError(res, 403, "Administrator permission is required.");
  next();
}
function sendError(res, status, message) {
  return res.status(status).json({ message });
}
function expiryFromInput(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    return date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function indiaDateKey(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(value);
  const item = {};
  for (const part of parts) if (part.type !== "literal") item[part.type] = part.value;
  return item.year + "-" + item.month + "-" + item.day;
}
function shiftDateKey(key, days) {
  const date = new Date(key + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function expiryDateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}
function money(value) {
  if (value === "" || value === undefined || value === null) return 0;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}
function integer(value, minimum) {
  if (value === "" || value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : null;
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}
function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}
function tokenFor(user) {
  return jwt.sign(
    { sub: String(user._id), name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "12h", issuer: "pim-pharmacy-inventory" }
  );
}
const requireAuth = wrap(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return sendError(res, 401, "Please sign in to continue.");
  }
  let payload;
  try {
    payload = jwt.verify(parts[1], JWT_SECRET, { issuer: "pim-pharmacy-inventory" });
  } catch (error) {
    return sendError(res, 401, "Your session has expired. Please sign in again.");
  }
  const user = await User.findById(payload.sub).select("_id name email role active");
  if (!user || user.active === false) return sendError(res, 401, "Account not found or deactivated. Please contact your administrator.");
  req.user = user;
  next();
});

app.get("/api/health", (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    ok: connected,
    service: "PIM",
    database: connected ? "connected" : "disconnected"
  });
});

app.get("/api/auth/status", wrap(async (req, res) => {
  const setupRequired = (await User.countDocuments()) === 0;
  res.json({ setupRequired });
}));

app.post("/api/auth/setup", wrap(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2) return sendError(res, 400, "Enter a name with at least 2 characters.");
  if (!validEmail(email)) return sendError(res, 400, "Enter a valid email address.");
  if (password.length < 10) return sendError(res, 400, "Use a password with at least 10 characters.");
  if (password.length > 200) return sendError(res, 400, "Password is too long.");
  if ((await User.countDocuments()) > 0) {
    return sendError(res, 409, "Administrator setup is already complete. Sign in instead.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await User.create({ name, email, passwordHash, role: "admin" });
    return res.status(201).json({
      token: tokenFor(user),
      user: { id: String(user._id), name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    if (error.code === 11000) return sendError(res, 409, "An account with that email already exists.");
    throw error;
  }
}));

app.post("/api/auth/login", wrap(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) return sendError(res, 400, "Enter your email and password.");
  const user = await User.findOne({ email });
  if (!user || user.active === false || !(await bcrypt.compare(password, user.passwordHash))) {
    return sendError(res, 401, "Email or password is incorrect.");
  }
  return res.json({
    token: tokenFor(user),
    user: { id: String(user._id), name: user.name, email: user.email, role: user.role }
  });
}));

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: { id: String(req.user._id), name: req.user.name, email: req.user.email, role: req.user.role, active: req.user.active !== false } });
});

app.get("/api/users", requireAuth, requireAdmin, wrap(async (req, res) => {
  const users = await User.find().select("_id name email role active createdAt updatedAt").sort({ createdAt: 1 }).lean();
  res.json({ users: users.map((user) => Object.assign({}, user, { active: user.active !== false })) });
}));

app.post("/api/users", requireAuth, requireAdmin, wrap(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const role = String(req.body.role || "staff");
  if (name.length < 2) return sendError(res, 400, "Enter a name with at least 2 characters.");
  if (!validEmail(email)) return sendError(res, 400, "Enter a valid email address.");
  if (password.length < 10 || password.length > 200) return sendError(res, 400, "Use a password between 10 and 200 characters.");
  if (!["admin", "staff"].includes(role)) return sendError(res, 400, "Choose a valid role.");
  try {
    const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role, active: true });
    return res.status(201).json({ user: { id: String(user._id), name: user.name, email: user.email, role: user.role, active: true, createdAt: user.createdAt } });
  } catch (error) {
    if (error.code === 11000) return sendError(res, 409, "An account with that email already exists.");
    throw error;
  }
}));

app.patch("/api/users/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 400, "Invalid user ID.");
  const target = await User.findById(req.params.id);
  if (!target) return sendError(res, 404, "User not found.");
  const body = req.body || {};
  const update = {};
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = String(body.name || "").trim();
    if (name.length < 2) return sendError(res, 400, "Name must have at least 2 characters.");
    update.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(body, "role")) {
    if (!["admin", "staff"].includes(body.role)) return sendError(res, 400, "Choose a valid role.");
    if (String(target._id) === String(req.user._id) && body.role !== "admin") return sendError(res, 400, "You cannot remove your own administrator role.");
    if (target.role === "admin" && body.role !== "admin" && await User.countDocuments({ role: "admin", active: { $ne: false } }) <= 1) {
      return sendError(res, 409, "At least one active administrator must remain.");
    }
    update.role = body.role;
  }
  if (Object.prototype.hasOwnProperty.call(body, "active")) {
    const active = body.active === true;
    if (String(target._id) === String(req.user._id) && !active) return sendError(res, 400, "You cannot deactivate your own account.");
    if (target.role === "admin" && !active && await User.countDocuments({ role: "admin", active: { $ne: false } }) <= 1) {
      return sendError(res, 409, "At least one active administrator must remain.");
    }
    update.active = active;
  }
  if (Object.prototype.hasOwnProperty.call(body, "password") && body.password !== "") {
    const password = String(body.password);
    if (password.length < 10 || password.length > 200) return sendError(res, 400, "Use a password between 10 and 200 characters.");
    update.passwordHash = await bcrypt.hash(password, 12);
  }
  const user = await User.findByIdAndUpdate(target._id, { $set: update }, { new: true, runValidators: true })
    .select("_id name email role active createdAt updatedAt").lean();
  res.json({ user: Object.assign({}, user, { active: user.active !== false }) });
}));

app.get("/api/dashboard", requireAuth, wrap(async (req, res) => {
  const todayKey = indiaDateKey(new Date());
  const soonKey = shiftDateKey(todayKey, 30);
  const [medicines, recentMovements, supplierCount] = await Promise.all([
    Medicine.find().lean(),
    StockMovement.find().sort({ createdAt: -1 }).limit(8).lean(),
    Supplier.countDocuments()
  ]);
  const expired = medicines.filter((item) => expiryDateKey(item.expiryDate) < todayKey);
  const expiring = medicines.filter((item) => {
    const key = expiryDateKey(item.expiryDate);
    return key >= todayKey && key <= soonKey;
  });
  const lowStock = medicines.filter((item) => item.quantity <= item.reorderLevel);
  const totalUnits = medicines.reduce((sum, item) => sum + item.quantity, 0);
  const inventoryValue = medicines.reduce((sum, item) => sum + item.purchasePrice * item.quantity, 0);
  res.json({
    summary: {
      batchCount: medicines.length,
      totalUnits,
      lowStockCount: lowStock.length,
      expiredCount: expired.length,
      expiringSoonCount: expiring.length,
      supplierCount,
      inventoryValue: Math.round(inventoryValue * 100) / 100
    },
    lowStock: lowStock.slice(0, 8),
    expired: expired.slice(0, 8),
    expiringSoon: expiring.slice(0, 8),
    recentMovements
  });
}));

app.get("/api/medicines", requireAuth, wrap(async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, 100);
  const status = String(req.query.status || "all");
  const filter = {};
  if (query) {
    const regex = new RegExp(escapeRegex(query), "i");
    filter.$or = [{ name: regex }, { brand: regex }, { batchNumber: regex }, { barcode: regex }, { category: regex }];
  }
  let medicines = await Medicine.find(filter).sort({ updatedAt: -1 }).lean();
  const todayKey = indiaDateKey(new Date());
  const soonKey = shiftDateKey(todayKey, 30);
  if (status === "low") medicines = medicines.filter((item) => item.quantity <= item.reorderLevel);
  if (status === "expired") medicines = medicines.filter((item) => expiryDateKey(item.expiryDate) < todayKey);
  if (status === "expiring") medicines = medicines.filter((item) => {
    const key = expiryDateKey(item.expiryDate);
    return key >= todayKey && key <= soonKey;
  });
  res.json({ medicines });
}));

app.post("/api/medicines", requireAuth, wrap(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const batchNumber = String(body.batchNumber || "").trim();
  const expiryDate = expiryFromInput(body.expiryDate);
  const quantity = integer(body.quantity === undefined ? 0 : body.quantity, 0);
  const reorderLevel = integer(body.reorderLevel === undefined ? 10 : body.reorderLevel, 0);
  const purchasePrice = money(body.purchasePrice);
  const sellingPrice = money(body.sellingPrice);
  if (name.length < 2) return sendError(res, 400, "Medicine name must have at least 2 characters.");
  if (!batchNumber) return sendError(res, 400, "Batch number is required.");
  if (!expiryDate) return sendError(res, 400, "Enter a valid expiry date.");
  if (quantity === null || reorderLevel === null) return sendError(res, 400, "Quantity and reorder level must be whole numbers of zero or more.");
  if (purchasePrice === null || sellingPrice === null) return sendError(res, 400, "Prices must be valid non-negative numbers.");
  let supplierId = null;
  if (body.supplierId) {
    if (!mongoose.isValidObjectId(body.supplierId)) return sendError(res, 400, "Choose a valid supplier.");
    if (!(await Supplier.exists({ _id: body.supplierId }))) return sendError(res, 400, "Supplier was not found.");
    supplierId = body.supplierId;
  }
  const medicineData = {
    name,
    brand: String(body.brand || "").trim(),
    category: String(body.category || "General").trim() || "General",
    batchNumber,
    barcode: String(body.barcode || "").trim(),
    manufacturer: String(body.manufacturer || "").trim(),
    supplierId,
    purchasePrice,
    sellingPrice,
    quantity,
    reorderLevel,
    expiryDate,
    storageLocation: String(body.storageLocation || "").trim(),
    notes: String(body.notes || "").trim()
  };
  let medicine;
  try {
    medicine = await Medicine.create(medicineData);
    if (quantity > 0) {
      await StockMovement.create({
        medicineId: medicine._id,
        medicineName: medicine.name,
        batchNumber: medicine.batchNumber,
        type: "IN",
        quantity,
        balanceAfter: quantity,
        note: "Opening stock",
        reference: "Initial entry",
        performedBy: req.user._id,
        performedByName: req.user.name
      });
    }
  } catch (error) {
    if (medicine) await Medicine.deleteOne({ _id: medicine._id }).catch(() => {});
    if (error.code === 11000) return sendError(res, 409, "A medicine batch with this name and batch number already exists.");
    throw error;
  }
  res.status(201).json({ medicine });
}));

app.put("/api/medicines/:id", requireAuth, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 400, "Invalid medicine ID.");
  const body = req.body || {};
  const update = {};
  const textFields = ["name", "brand", "category", "batchNumber", "barcode", "manufacturer", "storageLocation", "notes"];
  for (const field of textFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) update[field] = String(body[field] || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "supplierId")) {
    if (body.supplierId && !mongoose.isValidObjectId(body.supplierId)) return sendError(res, 400, "Choose a valid supplier.");
    if (body.supplierId && !(await Supplier.exists({ _id: body.supplierId }))) return sendError(res, 400, "Supplier was not found.");
    update.supplierId = body.supplierId || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "expiryDate")) {
    const expiryDate = expiryFromInput(body.expiryDate);
    if (!expiryDate) return sendError(res, 400, "Enter a valid expiry date.");
    update.expiryDate = expiryDate;
  }
  for (const field of ["purchasePrice", "sellingPrice"]) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const price = money(body[field]);
      if (price === null) return sendError(res, 400, "Prices must be valid non-negative numbers.");
      update[field] = price;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "reorderLevel")) {
    const level = integer(body.reorderLevel, 0);
    if (level === null) return sendError(res, 400, "Reorder level must be a whole number of zero or more.");
    update.reorderLevel = level;
  }
  if (update.name !== undefined && update.name.length < 2) return sendError(res, 400, "Medicine name must have at least 2 characters.");
  if (update.batchNumber !== undefined && !update.batchNumber) return sendError(res, 400, "Batch number is required.");
  try {
    const medicine = await Medicine.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
    if (!medicine) return sendError(res, 404, "Medicine batch not found.");
    res.json({ medicine });
  } catch (error) {
    if (error.code === 11000) return sendError(res, 409, "A medicine batch with this name and batch number already exists.");
    throw error;
  }
}));

app.delete("/api/medicines/:id", requireAuth, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 400, "Invalid medicine ID.");
  const medicine = await Medicine.findById(req.params.id);
  if (!medicine) return sendError(res, 404, "Medicine batch not found.");
  if (medicine.quantity > 0) return sendError(res, 409, "This batch still has stock. Record stock-out first.");
  if (await StockMovement.exists({ medicineId: medicine._id })) {
    return sendError(res, 409, "This batch has movement history and cannot be deleted. Keep it for the audit trail.");
  }
  await Medicine.deleteOne({ _id: medicine._id });
  res.json({ success: true });
}));

app.get("/api/suppliers", requireAuth, wrap(async (req, res) => {
  const suppliers = await Supplier.find().sort({ name: 1 }).lean();
  res.json({ suppliers });
}));

app.post("/api/suppliers", requireAuth, wrap(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  if (name.length < 2) return sendError(res, 400, "Supplier name must have at least 2 characters.");
  const supplier = await Supplier.create({
    name,
    contactPerson: String(body.contactPerson || "").trim(),
    phone: String(body.phone || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    address: String(body.address || "").trim(),
    notes: String(body.notes || "").trim()
  });
  res.status(201).json({ supplier });
}));

app.put("/api/suppliers/:id", requireAuth, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 400, "Invalid supplier ID.");
  const body = req.body || {};
  const update = {};
  for (const field of ["name", "contactPerson", "phone", "email", "address", "notes"]) {
    if (Object.prototype.hasOwnProperty.call(body, field)) update[field] = String(body[field] || "").trim();
  }
  if (update.name !== undefined && update.name.length < 2) return sendError(res, 400, "Supplier name must have at least 2 characters.");
  if (update.email) update.email = update.email.toLowerCase();
  const supplier = await Supplier.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
  if (!supplier) return sendError(res, 404, "Supplier not found.");
  res.json({ supplier });
}));

app.delete("/api/suppliers/:id", requireAuth, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 400, "Invalid supplier ID.");
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) return sendError(res, 404, "Supplier not found.");
  if (await Medicine.exists({ supplierId: supplier._id })) {
    return sendError(res, 409, "This supplier is linked to medicine batches. Update those batches first.");
  }
  await Supplier.deleteOne({ _id: supplier._id });
  res.json({ success: true });
}));

app.post("/api/stock/movements", requireAuth, wrap(async (req, res) => {
  const body = req.body || {};
  if (!mongoose.isValidObjectId(body.medicineId)) return sendError(res, 400, "Choose a valid medicine batch.");
  const type = String(body.type || "").toUpperCase();
  const quantity = integer(body.quantity, 1);
  if (!["IN", "OUT"].includes(type)) return sendError(res, 400, "Movement type must be Stock in or Stock out.");
  if (quantity === null) return sendError(res, 400, "Quantity must be a whole number greater than zero.");
  const note = String(body.note || "").trim();
  if (note.length > 300) return sendError(res, 400, "Note must be 300 characters or less.");
  const reference = String(body.reference || "").trim();
  if (reference.length > 100) return sendError(res, 400, "Reference must be 100 characters or less.");
  const current = await Medicine.findById(body.medicineId);
  if (!current) return sendError(res, 404, "Medicine batch not found.");
  if (type === "OUT" && expiryDateKey(current.expiryDate) < indiaDateKey(new Date())) {
    return sendError(res, 409, "Stock-out is blocked for an expired batch. Verify and quarantine expired stock.");
  }
  const change = type === "IN" ? quantity : -quantity;
  const query = { _id: current._id };
  if (type === "OUT") query.quantity = { $gte: quantity };
  const updated = await Medicine.findOneAndUpdate(query, { $inc: { quantity: change } }, { new: true, runValidators: true });
  if (!updated) return sendError(res, 409, "There is not enough stock for this stock-out.");
  try {
    const movement = await StockMovement.create({
      medicineId: updated._id,
      medicineName: updated.name,
      batchNumber: updated.batchNumber,
      type,
      quantity,
      balanceAfter: updated.quantity,
      note,
      reference,
      performedBy: req.user._id,
      performedByName: req.user.name
    });
    res.status(201).json({ movement, medicine: updated });
  } catch (error) {
    await Medicine.updateOne({ _id: updated._id }, { $inc: { quantity: -change } }).catch(() => {});
    throw error;
  }
}));

app.get("/api/stock/movements", requireAuth, wrap(async (req, res) => {
  const filter = {};
  if (req.query.type === "IN" || req.query.type === "OUT") filter.type = req.query.type;
  const movements = await StockMovement.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ movements });
}));

app.get("/api/reports", requireAuth, wrap(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number.parseInt(req.query.days, 10) || 90));
  const todayKey = indiaDateKey(new Date());
  const cutoffKey = shiftDateKey(todayKey, days);
  const medicines = await Medicine.find().populate("supplierId", "name").sort({ expiryDate: 1 }).lean();
  const expired = medicines.filter((item) => expiryDateKey(item.expiryDate) < todayKey);
  const expiring = medicines.filter((item) => {
    const key = expiryDateKey(item.expiryDate);
    return key >= todayKey && key <= cutoffKey;
  });
  const lowStock = medicines.filter((item) => item.quantity <= item.reorderLevel);
  const movements = await StockMovement.find({ createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }).lean();
  const monthIn = movements.filter((item) => item.type === "IN").reduce((sum, item) => sum + item.quantity, 0);
  const monthOut = movements.filter((item) => item.type === "OUT").reduce((sum, item) => sum + item.quantity, 0);
  const inventoryValue = medicines.reduce((sum, item) => sum + item.purchasePrice * item.quantity, 0);
  res.json({
    days,
    summary: {
      batchCount: medicines.length,
      unitsOnHand: medicines.reduce((sum, item) => sum + item.quantity, 0),
      lowStockCount: lowStock.length,
      expiredCount: expired.length,
      expiringCount: expiring.length,
      inventoryValue: Math.round(inventoryValue * 100) / 100,
      receivedLast30Days: monthIn,
      sentOutLast30Days: monthOut
    },
    expired,
    expiring,
    lowStock
  });
}));

app.use("/api", (req, res) => sendError(res, 404, "API route not found."));
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: 0
}));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (error.name === "ValidationError") return sendError(res, 400, "Some fields are invalid. Check the entered values.");
  if (error.name === "CastError") return sendError(res, 400, "Invalid record ID or field value.");
  return sendError(res, 500, "Something went wrong. Check the server logs and try again.");
});

module.exports = app;
