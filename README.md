# Jumia+ — online store starter

A responsive Nigerian online-store starter with product search, category filters, cart, delivery details, and a Paystack payment flow.

## Run locally

1. Install Node.js (18 or newer).
2. Open a terminal in this folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Add your own Paystack **test** secret key to `.env`.
6. Run `npm start`.
7. Open http://localhost:3000.

## Payment setup

- Create/manage your merchant account through Paystack.
- Start with test keys. Do not put the secret key in `public/index.html`.
- The backend initializes transactions and verifies the callback with Paystack.
- Configure the Paystack webhook URL as `https://YOUR_DOMAIN/api/paystack/webhook` after deploying with HTTPS.
- The webhook signature is checked using your secret key.
- Only treat an order as paid after server-side verification.

## Important limitations before real launch

This is a development starter, not a finished commercial marketplace.

- `orders.json` is a simple local persistence mechanism. Use a proper database (such as PostgreSQL) and backups for production.
- Add authentication and a protected admin dashboard before managing real orders.
- Add inventory reservation, shipping integrations, tax/returns policies, rate limiting, logging, monitoring, and customer notifications.
- Review the sample product names, images, prices and delivery fee. They are placeholders and are not live offers.
- Use HTTPS and secure hosting. Never commit `.env` or share secret keys.
- The storefront uses a distinct demo name and is not affiliated with Jumia.

## Product catalogue

The frontend and server each contain a sample product catalogue. Keep product IDs and prices in sync, or move catalogue data into a database and have the server provide it to the frontend.


## Added in the next build

- Product detail pop-up from each product card.
- Cart contents persist in the browser between page refreshes.
- Customer order lookup using the order reference (only status, total and date are exposed).
- Admin order dashboard at `/admin.html`, protected by HTTP Basic authentication using `ADMIN_PASSWORD`.
- Paystack webhook verification remains available at `/api/paystack/webhook`.

Admin dashboard setup:
1. Set a long, unique `ADMIN_PASSWORD` in `.env`.
2. Restart the server.
3. Visit `http://localhost:3000/admin.html`.
4. Enter username `admin` and the configured password when prompted.

Security note: HTTP Basic authentication must only be used over HTTPS outside local development. For a public production store, replace this simple admin gate with proper user accounts, role-based access, secure sessions, CSRF protection, rate limiting and audit logs. The current dashboard is read-only. Customer accounts and product/stock editing are not implemented yet.


## Product management (admin)

- Set `ADMIN_PASSWORD` in `.env`, then restart the server.
- Open `/admin.html` and enter the admin password when prompted.
- Use the Products tab to add, edit or delete catalogue items.
- Product records are stored in `products.json`; keep a backup of this file.
- The storefront loads products from `/api/products`, and checkout calculates prices from the server catalogue rather than trusting browser prices.
- Use HTTPS in production. This simple Basic Auth admin gate is a starter, not a substitute for production accounts, secure sessions, CSRF protection, rate limiting and audit logs.
