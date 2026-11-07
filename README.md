# Gada Electronics

A small electronics store (Node.js, Express, MongoDB) built as the practice project for a DevOps learning roadmap. The app is deliberately simple. The learning is in everything around it: Linux, Docker, CI/CD, Terraform, Ansible, Kubernetes and monitoring.

What it does: product catalogue with search and categories, customer accounts (JWT), shopping cart, checkout with stock control, order history, and a small admin view (add products, move orders through shipped, delivered or cancelled).

## Project layout

```
src/
  server.js          starts the app: connect to MongoDB, listen, shut down gracefully
  app.js             builds the Express app (security headers, routes, error handling)
  config.js          all configuration, read from environment variables
  routes/            health, auth, products, cart, orders
  models/            User, Product, Cart, Order
  middleware/        auth, request logging (JSON lines), error handling
  seed.js            starter products and an admin account
public/              the storefront (plain HTML, CSS and JavaScript, no build step)
tests/               API tests (Jest + Supertest)
```

## Run it locally

You need Node.js 20 or newer and a MongoDB instance.

```bash
npm install
cp .env.example .env            # then export the variables, or use: node --env-file=.env src/server.js
docker run -d --name gada-mongo -p 27017:27017 mongo:7    # quick local MongoDB (or install it natively)
npm run seed                    # 12 products + admin@gada.local / ChangeMe123!
npm run dev                     # http://localhost:3000
```

Commit the `package-lock.json` that `npm install` creates. CI will use `npm ci`, which needs it.

## Tests and lint

```bash
npm test        # starts an in-memory MongoDB automatically (first run downloads its binary)
npm run lint
```

In CI you can point the tests at a real MongoDB service container instead: set `TEST_MONGO_URI=mongodb://localhost:27017/gada_test`.

## Configuration

Everything comes from environment variables, so the same build runs unchanged in every environment.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/gada_electronics` | differs per environment |
| `JWT_SECRET` | dev-only value | **required** when `NODE_ENV=production` (the app refuses to start without it) |
| `JWT_EXPIRES_IN` | `1h` | |
| `BCRYPT_ROUNDS` | `10` | |
| `APP_VERSION` | `dev` | returned by `/health`; set it to the image tag or commit SHA in deployments |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `admin@gada.local`, `ChangeMe123!` (not in production) | used by `npm run seed` |

## API

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | public | liveness: the process is running |
| GET | `/ready` | public | readiness: the database is reachable (503 otherwise) |
| POST | `/api/auth/register` | public | create a customer account |
| POST | `/api/auth/login` | public | get a token |
| GET | `/api/auth/me` | user | current user |
| GET | `/api/products` | public | list; query `q`, `category`, `page`, `limit` |
| GET | `/api/products/categories` | public | category names |
| GET | `/api/products/:id` | public | one product |
| POST, PUT, DELETE | `/api/products[/:id]` | admin | manage products |
| GET | `/api/cart` | user | current cart with totals |
| POST | `/api/cart/items` | user | add `{ productId, quantity }` |
| PATCH, DELETE | `/api/cart/items/:productId` | user | change quantity (0 removes) or remove |
| POST | `/api/orders` | user | checkout the cart |
| GET | `/api/orders` | user | own orders (`?all=true` lists everyone's for admins) |
| GET | `/api/orders/:id` | owner or admin | one order |
| PATCH | `/api/orders/:id/status` | admin | `shipped`, `delivered` or `cancelled` |

## What is intentionally missing

These are the things you will add during the roadmap, so they are not here yet: Dockerfile and Compose file, CI pipeline, Terraform and Ansible code, Kubernetes manifests, a `/metrics` endpoint for Prometheus, TLS, and a managed or replicated database.

## Things worth understanding in this code

These are the points an interviewer or a production incident will eventually ask about.

- **Liveness vs readiness** (`src/routes/health.js`): `/health` says the process is alive, `/ready` says it can serve traffic. Load balancers and Kubernetes use them for different decisions.
- **Graceful shutdown** (`src/server.js`): on SIGTERM the app stops accepting connections, finishes in-flight requests and closes the database. Docker, systemd and Kubernetes all stop containers this way.
- **JSON logs on stdout** (`src/middleware/logger.js`): one object per line, which is what log shippers expect. Apps should not write their own log files.
- **Checkout without transactions** (`src/routes/orders.js`): a standalone MongoDB cannot run multi-document transactions, so stock is reserved with an atomic conditional update and rolled back on failure. Compare with replica sets and transactions when you reach the database phase.
- **Helmet and plain HTTP** (`src/app.js`): the default security headers include `upgrade-insecure-requests`, which makes browsers request CSS and JavaScript over https. On a server that only speaks HTTP (an EC2 instance before TLS is set up) the page loads unstyled and broken. The app removes that directive; once nginx or a load balancer terminates TLS, you can put it back.
- **Trusting the proxy** (`app.set('trust proxy', 1)`): behind nginx or a load balancer, the real client IP arrives in a header. This setting is what lets the app read it. Set it wrongly and every request appears to come from the proxy.
- **Query input** (`src/validate.js`): `?q[$ne]=x` arrives as an object, not a string. The app only accepts plain strings so request input never becomes a MongoDB operator.

## Run with Docker

Needs Docker Desktop, or Docker Engine with the Compose plugin. Only nginx is published (port 8080); the app and MongoDB are reachable only inside the Compose network.

    echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
    docker compose up -d --build
    read -rsp "Admin password: " ADMIN_PASSWORD; echo
    docker compose run --rm -e ADMIN_PASSWORD="$ADMIN_PASSWORD" app node src/seed.js
    unset ADMIN_PASSWORD

Then open http://localhost:8080 and log in as admin@gada.local.

Useful commands: `docker compose ps`, `docker compose logs -f app`, `docker compose down` (keeps data) and `docker compose down -v` (DELETES the database volume).

MongoDB is pinned to 7.0 on purpose. Some MongoDB 8.0.x releases refuse to start on Linux kernel 6.19 and newer (seen on Ubuntu's 7.0 kernel with 8.0.34), and containers share the host's kernel.
