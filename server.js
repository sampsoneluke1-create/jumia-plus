import express from "express";
import dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 3000);
const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ordersFile = path.join(__dirname, "orders.json");
const productsFile = path.join(__dirname, "products.json");

async function readProducts() {
  try {
    const rows = JSON.parse(await fs.readFile(productsFile, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
async function saveProducts(rows) {
  await fs.writeFile(productsFile, JSON.stringify(rows, null, 2), { mode: 0o600 });
}
function validateProduct(input) {
  const p = input || {};
  const name = typeof p.name === "string" ? p.name.trim() : "";
  const category = typeof p.category === "string" ? p.category.trim() : "";
  const image = typeof p.image === "string" ? p.image.trim() : "";
  const price = Number(p.price), oldPrice = Number(p.oldPrice);
  if (!name || name.length > 160 || !category || category.length > 80 ||
      !Number.isSafeInteger(price) || price < 1 || price > 1000000000 ||
      !Number.isSafeInteger(oldPrice) || oldPrice < price || oldPrice > 1000000000 ||
      !image || image.length > 1500 || !/^https:\/\//i.test(image)) {
    return { error: "Enter a product name, category, valid NGN prices (old price must be at least the current price), and an HTTPS image URL." };
  }
  return { product: {
    name, category, price, oldPrice,
    discount: oldPrice > price ? `-${Math.round((oldPrice-price)/oldPrice*100)}%` : "0%",
    rating: 0, reviews: 0, image
  }};
}
const DELIVERY_FEE = 2500;

async function readOrders() {
  try { return JSON.parse(await fs.readFile(ordersFile, "utf8")); }
  catch { return {}; }
}
async function saveOrder(order) {
  const orders = await readOrders();
  orders[order.reference] = order;
  await fs.writeFile(ordersFile, JSON.stringify(orders, null, 2), { mode: 0o600 });
}
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "20kb" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/orders/:reference", async (req, res) => {
  const reference = req.params.reference;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(reference)) {
    return res.status(400).json({ message: "Invalid order reference." });
  }
  const orders = await readOrders();
  const order = orders[reference];
  if (!order) return res.status(404).json({ message: "Order not found. Check the reference and try again." });
  // Do not expose customer contact or delivery address through public tracking.
  return res.json({
    reference: order.reference,
    status: order.status,
    total: order.total,
    createdAt: order.createdAt
  });
});

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ message: "Admin access is not configured. Set ADMIN_PASSWORD in .env." });
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Jumia+ Admin"');
    return res.status(401).json({ message: "Admin authentication required." });
  }
  let credentials;
  try { credentials = Buffer.from(encoded, "base64").toString("utf8"); }
  catch { return res.sendStatus(401); }
  const separator = credentials.indexOf(":");
  const password = separator >= 0 ? credentials.slice(separator + 1) : "";
  const supplied = Buffer.from(password);
  const expected = Buffer.from(ADMIN_PASSWORD);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Jumia+ Admin"');
    return res.status(401).json({ message: "Incorrect admin password." });
  }
  next();
}

app.get("/api/admin/orders", requireAdmin, async (_req, res) => {
  const orders = await readOrders();
  const list = Object.values(orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(list.map(order => ({
    reference: order.reference,
    customerName: order.customer.name,
    email: order.customer.email,
    phone: order.customer.phone,
    address: order.customer.address,
    items: order.items,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    status: order.status,
    createdAt: order.createdAt
  })));
});


app.get("/api/products", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await readProducts());
});
app.get("/api/admin/products", requireAdmin, async (_req, res) => {
  res.json(await readProducts());
});
app.post("/api/admin/products", requireAdmin, async (req, res) => {
  const checked = validateProduct(req.body);
  if (checked.error) return res.status(400).json({ message: checked.error });
  const rows = await readProducts();
  const id = rows.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0) + 1;
  const product = { id, ...checked.product };
  rows.push(product); await saveProducts(rows);
  res.status(201).json(product);
});
app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return res.status(400).json({ message: "Invalid product ID." });
  const checked = validateProduct(req.body);
  if (checked.error) return res.status(400).json({ message: checked.error });
  const rows = await readProducts(), index = rows.findIndex(p => p.id === id);
  if (index < 0) return res.status(404).json({ message: "Product not found." });
  rows[index] = { id, ...checked.product }; await saveProducts(rows);
  res.json(rows[index]);
});
app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id), rows = await readProducts();
  const next = rows.filter(p => p.id !== id);
  if (next.length === rows.length) return res.status(404).json({ message: "Product not found." });
  await saveProducts(next); res.json({ message: "Product deleted." });
});

app.post("/api/checkout/initialize", async (req, res) => {
  try {
    if (!SECRET_KEY) return res.status(503).json({ message: "Payment gateway is not configured. Add your Paystack test secret key to .env." });
    const { customer, cart } = req.body || {};
    if (!customer || typeof customer.name !== "string" || typeof customer.email !== "string" ||
        typeof customer.phone !== "string" || typeof customer.address !== "string" ||
        !customer.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) ||
        !customer.phone.trim() || !customer.address.trim() ||
        customer.name.length > 100 || customer.email.length > 254 ||
        customer.phone.length > 30 || customer.address.length > 500) {
      return res.status(400).json({ message: "Please provide valid name, email, phone and delivery address." });
    }
    if (!Array.isArray(cart) || cart.length < 1 || cart.length > 20) {
      return res.status(400).json({ message: "Your cart is empty or invalid." });
    }
    const catalogue = await readProducts();
    const productMap = Object.fromEntries(catalogue.map(p => [p.id, p]));
    let subtotal = 0;
    const items = [];
    for (const row of cart) {
      const id = Number(row?.id), qty = Number(row?.qty), product = productMap[id];
      if (!product || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ message: "A product or quantity in your cart is invalid." });
      }
      subtotal += product.price * qty;
      items.push({ id, name: product.name, price: product.price, qty });
    }
    const total = subtotal + DELIVERY_FEE;
    const reference = `SH${Date.now()}${crypto.randomBytes(5).toString("hex")}`;
    const order = {
      reference, customer: {
        name: customer.name.trim(), email: customer.email.trim().toLowerCase(),
        phone: customer.phone.trim(), address: customer.address.trim()
      },
      items, subtotal, deliveryFee: DELIVERY_FEE, total,
      amountKobo: total * 100, currency: "NGN", status: "pending",
      createdAt: new Date().toISOString()
    };
    await saveOrder(order);
    const gatewayResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: order.customer.email, amount: order.amountKobo,
        currency: "NGN", reference,
        callback_url: `${APP_URL}/api/checkout/callback`
      })
    });
    const gateway = await gatewayResponse.json();
    if (!gatewayResponse.ok || !gateway.status || !gateway.data?.authorization_url) {
      order.status = "initialization_failed";
      await saveOrder(order);
      return res.status(502).json({ message: gateway.message || "Unable to initialize payment." });
    }
    res.json({ authorization_url: gateway.data.authorization_url });
  } catch (error) {
    console.error("Checkout initialization error:", error);
    res.status(500).json({ message: "Checkout could not be started. Please try again." });
  }
});

app.get("/api/checkout/callback", async (req, res) => {
  try {
    if (!SECRET_KEY) return res.redirect("/?payment=failed");
    const reference = req.query.reference;
    if (typeof reference !== "string" || reference.length > 100) return res.redirect("/?payment=failed");
    const orders = await readOrders();
    const order = orders[reference];
    if (!order) return res.redirect("/?payment=failed");

    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${SECRET_KEY}` }
    });
    const verification = await verifyResponse.json();
    const data = verification.data;
    const valid = verifyResponse.ok && verification.status === true &&
      data?.status === "success" && data.reference === reference &&
      data.amount === order.amountKobo && data.currency === "NGN" &&
      data.customer?.email?.toLowerCase() === order.customer.email;

    if (!valid) {
      order.status = "payment_not_verified";
      await saveOrder(order);
      return res.redirect("/?payment=failed");
    }
    order.status = "paid";
    order.paidAt = new Date().toISOString();
    await saveOrder(order);
    return res.redirect(`/?payment=success&order=${encodeURIComponent(reference)}`);
  } catch (error) {
    console.error("Payment verification error:", error);
    return res.redirect("/?payment=failed");
  }
});

// Paystack webhook: configure this endpoint in your Paystack dashboard.
// Verify the signature before trusting the event.
app.post("/api/paystack/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!SECRET_KEY) return res.sendStatus(503);
  const signature = req.headers["x-paystack-signature"];
  const expected = crypto.createHmac("sha512", SECRET_KEY).update(req.body).digest("hex");
  const a = Buffer.from(String(signature || ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
  try {
    const event = JSON.parse(req.body.toString("utf8"));
    if (event.event === "charge.success") {
      const data = event.data;
      const orders = await readOrders();
      const order = orders[data.reference];
      if (order && data.status === "success" && data.amount === order.amountKobo &&
          data.currency === "NGN" && data.customer?.email?.toLowerCase() === order.customer.email) {
        order.status = "paid";
        order.paidAt = new Date().toISOString();
        await saveOrder(order);
      }
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error("Webhook processing error:", error);
    return res.sendStatus(400);
  }
});

app.listen(PORT, () => console.log(`Jumia+ running at ${APP_URL}`));
