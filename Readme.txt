
CONTENTS OF THE SUBMISSION
--------------------------
  source/      all source code + docker-compose.yml (the "src" folder, cleaned)
  demo.mp4     product introduction video
  git/         GitHub Insights screenshots (teamwork evidence)
  Bonus/       description and evidence of the four bonus features
  Readme.txt   this file
  Rubrik.docx  self-assessment
  Report.docx  project report (+ Report.pdf)


1. REQUIREMENTS
---------------
  * Docker Desktop (Windows/macOS) or Docker Engine + Compose v2 (Linux)
  * About 4 GB of free RAM (ElasticSearch uses a 512 MB heap) and 3 GB of disk
  * Free ports: 8080 (website), 8025 (e-mail inbox), 15672 (RabbitMQ UI)
  Nothing else: Node.js and npm are NOT needed on the host.


2. RUN THE PROJECT (ONE COMMAND)
--------------------------------
  Open a terminal in the source folder (the one containing docker-compose.yml):

      docker compose up -d

  The first start builds 7 images and downloads PostgreSQL, Redis, RabbitMQ,
  ElasticSearch, Mailpit and Nginx (about 3-6 minutes depending on the network).
  On the first start the API creates the schema and loads demo data:
  9 categories, 118 products (264 variants, 3-4 real product photos each - no
  internet needed, the photos ship in services/api/src/seed/images and are
  stored in PostgreSQL; about half on sale; 13-14 products per category, so
  every category has two pages), 160 customers, ~1,000 orders since January
  2024, ratings and comments.

  Then open:   http://localhost:8080          the shop
               http://localhost:8080/admin    the administrator area
               http://localhost:8025          inbox with every e-mail the shop sends

  "docker compose ps" shows 15 containers (api x3 and realtime x2 included);
  the api containers report "healthy" when ready.


3. ACCOUNTS WITH PRE-LOADED DATA
--------------------------------
  Administrator   admin@techhaven.local      /  Admin@123
  Customer        customer@techhaven.local   /  Customer@123
                  (2 saved addresses, order history, loyalty points)

  Discount codes with remaining uses: NEW26 (8%), SV100 (100,000 VND),
  GAME7 (7%), TECH1 (200,000 VND), VIP10 (10%), WELC5 (5%).
  The administrator can create more (5 letters/digits, at most 10 uses).

  Test cards for the simulated card payment:
      4242 4242 4242 4242   any future expiry (e.g. 12/29), any CVC -> approved
      4000 0000 0000 0002                                            -> declined

  RabbitMQ management UI: http://localhost:15672   (techhaven / techhaven)


4. E-MAIL, GOOGLE SIGN-IN AND AI (OPTIONAL .env)
------------------------------------------------
  The project runs without any .env file:

  * E-MAIL: every e-mail (order confirmation, set-password link for new and
    guest accounts, password recovery, order status updates) is delivered to
    the Mailpit inbox at http://localhost:8025 - open it to read the e-mails
    and click their links. To send real e-mails through Gmail instead, copy
    ".env.example" to ".env", uncomment the SMTP_* lines and set SMTP_USER =
    your Gmail address, SMTP_PASS = a Gmail App Password (Google Account >
    Security > 2-Step Verification > App passwords).

  * GOOGLE SIGN-IN: create an OAuth client ID of type "Web application" in
    Google Cloud Console with the authorised redirect URI
        http://localhost:8080/api/auth/google/callback
    and set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env. Without them the
    "Continue with Google" button is shown as "not configured".

  * AI ASSISTANT (Google Gemini): create a free API key at
        https://aistudio.google.com/apikey
    and set GEMINI_API_KEY in .env (GEMINI_MODEL defaults to
    gemini-3.5-flash-lite, which answers in about 2 seconds). Gemini writes the
    replies but may only recommend products found in the shop.
    "docker compose logs assistant" shows "language model: Gemini (...)" when
    the key is loaded. Without a key - or if the key is invalid, the free quota
    is used up or Gemini takes more than 25 s - the assistant answers with its
    own rule-based replies built on the live catalogue, so it always works.
    The .env file holds the real key: never commit or submit it.

  After editing .env run "docker compose up -d" again.


5. GUIDED TOUR (WHAT TO TRY)
----------------------------
  Customer side (no sign-in needed)
   - Home page: slides, shop by need, Hot Deals, New Products, Best Sellers and
     5 category sections (Laptops, Desktop PCs, Monitors, Graphics Cards,
     Storage) with brand tabs - every product list has page numbers.
   - "All products" or a category: grid/list view, pagination (page numbers
     always visible), sort by name A-Z/Z-A, price low/high, newest, best
     selling, rating, biggest discount; filter by brand, min/max price, rating,
     in stock, on sale, category and tags.
   - Search box: ElasticSearch with typo tolerance ("samsng") and suggestions.
   - Product page: 1-10 images with zoom, original price and -x% badge,
     overview of 5+ lines, variants with their own price and stock, buy now,
     wish list, compare, specifications, comments (no login) and star ratings
     (login). Open the same product in two windows and post a comment: it
     appears in the other window instantly (WebSocket) and receives an AI
     sentiment label (positive / neutral / negative).
   - Cart and mini-cart: quantities and totals (VAT, shipping) update without
     reloading; enter a discount code to see its effect before paying.
   - Checkout as a guest (3 steps). An account is created automatically for
     the e-mail; the set-password link arrives in the Mailpit inbox.
   - Track order (top bar): order number + e-mail, no account needed.
   - Compare up to 4 products, wish list, recently viewed products.
   - AI assistant (chat bubble, bottom right): e.g. "Tu van laptop gaming duoi
     30 trieu", "Do you have an RTX 4070?", "Phi giao hang bao nhieu?".

  Signed-in customer (customer@techhaven.local)
   - Profile: edit name/phone, change password, manage several addresses.
   - Checkout: default address pre-filled, can pick another one; spend
     loyalty points (1 point = 1,000 VND, earn 10% of every order).
   - My orders: history, details, status history (newest first).

  Administrator (admin@techhaven.local)  ->  http://localhost:8080/admin
   - Dashboard > Overview: users, new users, orders, revenue, best sellers,
     orders by status and "Needs attention" (orders to confirm/ship, low stock).
   - Dashboard > Advanced analytics: yearly (default), quarterly, monthly,
     weekly or custom range; orders, revenue, profit, products and product
     types sold, comparison charts.
   - Products: variants (price, original price, cost, stock), 1 to 10
     illustration images per product (upload, drag & drop or https URL,
     reorder, choose the cover), categories; Orders (20 per page, filter
     today/yesterday/this week/this month/range, change status); Users (view,
     edit, ban); Discount codes (list, usage, orders, create).


6. HORIZONTAL SCALING
---------------------
  Nginx (gateway) load-balances 3 API replicas and 2 realtime replicas. The API
  is stateless (JWT cookie, cart in the browser, images in PostgreSQL), so you
  can add servers at any time:

      docker compose up -d --scale api=5
      node tests/scale-demo.mjs 100        (needs Node.js on the host)

  Every API response carries an "X-Instance" header showing which replica
  served it. Evidence: Bonus/scaling-and-resilience.txt


7. TESTS
--------
  Unit tests (Node.js 22+ on the host), 25 tests in total:
      cd services/api       && npm ci && npm test   (pricing, loyalty, validation, images)
      cd services/mailer    && npm ci && npm test   (e-mail templates)
      cd services/assistant && npm ci && npm test   (sentiment analysis, chatbot parsing, Gemini prompt, follow-up context)
  End-to-end scenario against the running stack (66 checks, including the
  delivery of the confirmation e-mail to the Mailpit inbox):
      node tests/e2e-api.mjs http://localhost:8080
  CI: .github/workflows/ci.yml runs all of the above on GitHub Actions.


8. STOP / RESET
---------------
  Stop:                     docker compose down
  Reset all data (re-seed): docker compose down -v   then   docker compose up -d


9. BONUS FEATURES IMPLEMENTED (details in the Bonus folder)
-----------------------------------------------------------
  [x] CI/CD pipeline with GitHub Actions
  [x] Microservices architecture: api, realtime, mailer, search, assistant
      (+ frontend, gateway, databases) with asynchronous communication through
      RabbitMQ and Redis pub/sub
  [x] AI features: shopping-assistant chatbot that recommends products from the
      catalogue, and sentiment analysis of product comments
  [x] ElasticSearch for product search


10. TROUBLESHOOTING
-------------------
  * Port 8080 in use: set WEB_PORT=8081 in .env (and PUBLIC_URL accordingly).
  * "elasticsearch" exits on Linux hosts: run
        sudo sysctl -w vm.max_map_count=262144
  * The website shows no products right after start: wait until
    "docker compose ps" reports the api containers as healthy.
