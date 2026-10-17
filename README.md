# PIM — Pharmacy Inventory Management

A full-stack pharmacy inventory prototype for tracking medicine batches, expiry dates, suppliers, stock movements, low-stock alerts, and inventory reports.

## Features

- First-run administrator setup and password-based sign-in.
- Medicine records by batch, including batch number, expiry date, purchase/selling price, reorder level, and storage location.
- Supplier management.
- Stock-in and stock-out movements with user, time, quantity, and resulting balance recorded in an audit history.
- Dashboard totals, low-stock warnings, expired/soon-to-expire batch lists, and inventory value.
- Search, status filters, and CSV exports.
- Responsive desktop/mobile layout.

**Scope:** This is an educational inventory prototype. It is not a dispensing, prescription, billing, or regulatory-compliance system. Do not use it as the sole record for an operating pharmacy until it has been independently security-reviewed, tested, backed up, and adapted to applicable pharmacy/data-protection requirements. Demo records are not medical advice.

## Technology

- Frontend: HTML, CSS, browser JavaScript.
- Backend: Node.js and Express REST API.
- Database: MongoDB Atlas.
- Password hashing: bcrypt; authentication: signed JWT.
- Hosting: Render Web Service (free tier) with MongoDB Atlas Free cluster.

The frontend and API are served from the same app, so you do not need to configure cross-origin requests.

## Run locally

Use Node.js 20 or newer and a MongoDB database.

1. Clone this repository.
2. Install dependencies:
   ~~~bash
   npm install
   ~~~
3. Copy the .env.example file to .env and set MONGODB_URI to your Atlas connection string. Add a long, random JWT_SECRET.
4. Start the app:
   ~~~bash
   npm start
   ~~~
5. Open http://localhost:10000. On the first visit, create the administrator account. Setup becomes unavailable after the first account is created.

If your local MongoDB connection uses a different URI, update the .env value. Never commit .env, database credentials, or real pharmacy/customer data.

## Free deployment on Render

1. Create a MongoDB Atlas project and a Free cluster. Create a database user and configure Network Access for your deployment. For a simple student demo you may temporarily use Atlas's 0.0.0.0/0 IP access rule, but it exposes the database endpoint to connection attempts from any IP; use a strong database password and restrict access when possible. Never share the connection string.
2. Copy the Atlas driver's connection string and replace the username/password placeholders. The URI should include a database name, for example ...mongodb.net/pim?retryWrites=true&w=majority.
3. In Render, choose New → Web Service, connect this GitHub repository, then set:
   - Build command: npm install
   - Start command: npm start
   - NODE_ENV: production
   - MONGODB_URI: your private Atlas connection string
   - JWT_SECRET: a long, random secret (use Render's generated secret option if available).
4. Select a free instance and deploy. The included render.yaml can also be used as a deployment blueprint; provide MONGODB_URI when prompted.
5. Open the Render URL, create the first administrator account, add suppliers, and then add medicine batches.

**Important free-tier caveats:** Render free web services sleep after 15 minutes without inbound traffic and may take about a minute to wake. Their local filesystem is temporary, so this app stores inventory in MongoDB rather than local files. Atlas Free has storage and throughput limits and is suitable for a prototype, not a production pharmacy. See the official docs linked below for current plan limits.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| MONGODB_URI | Yes | MongoDB connection string |
| JWT_SECRET | Yes in production | Secret used to sign login tokens |
| PORT | No | Server port (defaults to 10000) |
| NODE_ENV | No | Set to production when deployed |

## Useful links

- Render free deployment: https://render.com/docs/free
- Render Node/Express deployment: https://render.com/docs/deploy-node-express-app
- MongoDB Atlas Free-cluster limitations: https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/

## Project structure

~~~text
PIM/
├── app.js                 # Express API, validation, authentication
├── server.js              # MongoDB connection and HTTP server
├── public/
│   ├── index.html         # Application shell
│   ├── styles.css         # Responsive styling
│   └── app.js             # Browser UI and API client
├── .env.example
├── render.yaml
└── package.json
~~~

## First-use workflow

1. Create the administrator login.
2. Add supplier details.
3. Add one medicine record per batch, including its expiry date and opening quantity.
4. Use Stock movements for every receipt/dispensing/stock-out event. Avoid editing the database directly.
5. Check Dashboard and Reports for low stock and expiry warnings.

Expiry alerts and inventory value are derived from the batch data entered by the user. Verify all quantities, prices, and expiry dates against the actual packaging and records.
