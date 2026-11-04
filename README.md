<!-- 

C:\Users\sudha\OneDrive\Documents\Desktop\salon-1\backend


C:\Users\sudha\OneDrive\Documents\Desktop\salon-1\frontend


 -->

# SalonFlow

SalonFlow is a React/Vite salon discovery and queue-booking app backed by an Express API and MongoDB. The app includes email/SMS OTP account verification, HTTP-only JWT sessions, live queue estimates, standard FIFO and express priority, UPI advance payment instructions with administrator bank verification, owner operations, admin approval, filtered reports, and CSV export.

Users can save a required, unverified salon contact phone number in their profile. Salon owners see it in the active queue and can tap it to call; it is separate from the verified sign-in phone.

## Requirements

- Node.js 20.19+ (or 22.12+) and npm
- MongoDB (local or MongoDB Atlas)
- A Gmail App Password for email OTP
- Twilio credentials for SMS OTP
- Razorpay test keys only if exercising legacy Razorpay payment records

SMS cannot be delivered directly from an ordinary website to a handset without a carrier or messaging gateway. Configure Twilio (or replace the SMS adapter with a compliant local provider). Email and phone OTP delivery fail explicitly when their provider credentials are absent; codes are never returned by the API or logged.

## Local development

1. Copy `backend/.env.example` to `backend/.env`, then set `DB_URI`, `JWT_SECRET`, `OTP_SECRET`, `ADMIN_UPI_ID`, and `ADMIN_UPI_NAME`, plus any provider credentials you want to test. Use different, randomly generated secrets of at least 32 characters. UPI settings are required to create bookings.
2. Keep `SEED_DEMO_SALONS=true` only for local development. The first successful database connection inserts example salons if the database is empty.
3. Install and start the API:

   ```powershell
   cd backend
   npm install
   npm run dev
   ```

4. In another terminal, install and start React:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

   The Vite development server proxies `/api` requests to `http://localhost:5000`.

5. To create the initial administrator, set `ADMIN_EMAIL` and a non-empty `ADMIN_PASSWORD` in the private backend environment file. Passwords may use any characters and length. On startup, the backend creates the admin account if it does not exist; keep these values in your private environment configuration for restarts. Sign in through the regular email/password form. If the email already belongs to a non-admin account, startup stops rather than silently granting it admin access; choose a separate email. Do not assign an admin role through public registration.

## Production setup

- Provision MongoDB Atlas or another managed MongoDB deployment and use its TLS connection string as `DB_URI`.
- Set `NODE_ENV=production`, `SEED_DEMO_SALONS=false`, strong unique JWT/OTP secrets, exact allowed frontend origins in `FRONTEND_URL` (comma-separated if required), credentials for the email and SMS providers, and the platform's `ADMIN_UPI_ID` and `ADMIN_UPI_NAME`.
- Legacy Razorpay checkout records still use signature and capture verification. New bookings do not use Razorpay. A Razorpay webhook endpoint and in-app full-payment refund workflow are not implemented; add and test those before handling legacy live-money flows at scale.
- New bookings use a fixed ₹1 standard reservation advance or ₹25 express advance sent to the configured platform UPI ID; salon services are paid by the customer at the salon. The backend creates a UPI intent and the frontend generates the QR locally (no QR API or payment gateway is used). The UPI app/bank does not send an authenticated payment result to this website, so UPI references submitted by customers remain pending and are never treated as proof. An administrator must match the reference and exact credit in the bank account before using “Confirm bank credit”; only then does the booking enter the queue. Do not expose an unauthenticated webhook or automatically trust a client-submitted UTR. A genuinely automatic flow requires a bank/payment-provider integration with an authenticated transaction notification; direct UPI intents alone cannot provide it.
- If an administrator cancels an unverified reference after checking that no credit arrived, the booking is cancelled. Eligible cancellations after payment verification return the advance as SalonFlow credit according to the existing cancellation policy; this is not an automatic bank refund.
- If the API runs behind a reverse proxy, set `TRUST_PROXY` to the exact number of trusted proxy hops; do not enable broad proxy trust.
- Deploy the API with `backend/Dockerfile`. The React static build can be hosted on a static platform or built with `frontend/Dockerfile`. When deploying the frontend separately, set `VITE_API_BASE_URL` at build time.
- For browser cookies, prefer serving the frontend and API on the same site behind a reverse proxy. If they must be cross-site, use HTTPS, set `COOKIE_SAME_SITE=none`, configure credentialed CORS with the exact frontend origin, and test that the browser permits the cookie.
- Never commit `.env` files or put MongoDB, JWT, SMTP, Twilio, Cloudinary, or Razorpay secret credentials in the frontend.

`CLOUDINARY_*` variables are reserved for a future image-upload integration; salon image uploads are not implemented yet. Map rendering and external map tiles also require a map provider and are not included; nearby distance sorting uses the browser's location permission and server-side haversine distance.

Salon cards show distances below 1 km in metres and distances of 1 km or more in kilometres, without displaying location-accuracy margins. A recent accepted location fix is reused across page refreshes for up to 30 minutes. Automatic location updates accept fixes reported within 5 km accuracy, retain more reliable readings over coarser ones, and allow a substantially more accurate GPS fix to replace a coarse network location. Salon-list responses from older location requests are discarded. Selecting a salon opens its booking panel in a dismissible overlay on mobile and tablet layouts; desktop keeps the inline booking panel.

## API overview

- `POST /api/auth/send-otp`, `/verify-otp`, `/register`, `/login`, `/reset-password`, `/logout`; `GET /api/auth/me`
- `GET /api/salons` supports `search`, `city`, `openNow`, `maxWait`, `maxPrice`, `maxDistanceKm`, `lat`, and `lng`
- `POST /api/bookings` creates a pending UPI booking; `POST /api/bookings/:id/upi-reference` records a customer's claimed reference, which is not payment proof. An admin must verify the bank credit through `/api/admin/management/bookings/:id/payment-confirmation` before it joins the queue. `/api/bookings/:id/verify-payment` remains for legacy Razorpay bookings.
- `GET /api/bookings/my-bookings`; `GET /api/bookings/history` provides role-scoped booking history with date, time-of-day, status, and (where applicable) salon-name filters. Owner queue/report routes are under `/api/bookings/owner`.
- Salon owners can block or unblock a customer for future bookings at one salon with `PATCH /api/salons/mine/:id/customers/:customerId/block`; existing bookings are not changed. The My salon queue view lists blocked customers for the selected salon, so owners can unblock them even after their bookings leave recent history. `PATCH /api/bookings/:id/status` starts, completes, or rejects queue bookings. Rejections are limited to waiting bookings and require a saved reason; the customer is emailed a secure, expiring feedback link. `GET/POST /api/bookings/rejection-feedback` validates and saves the customer's one-time feedback response. Rejection does not modify payment records or automatically issue refunds; rejected bookings are excluded from salon income reports.
- Admin reports at `/api/admin/reports` and `/api/admin/reports.csv`; admin salon approval at `/api/admin/salons`
- `GET /api/health` is a liveness endpoint

The admin account uses the same sign-in form as other accounts. After sign-in, the app opens the requested destination; admin and salon-owner dashboard access is determined by the account role.

The shared “Orders & history” navigation destination shows only the signed-in customer's bookings, bookings for the signed-in owner's salons, or all bookings for an administrator. Results are ordered newest first and can be filtered by booking status, date range, and local time-of-day range; customers and admins can also filter by salon name. Owners see only their salons' history, so a salon-name filter is omitted for them. The “Discover” and “Book a visit” navigation labels are hidden, but salon discovery and booking remain available on the home page.

Registration and password reset use a staged OTP flow: enter an email (or select mobile verification), request the code, enter its six digits, and verify it before password fields appear. The backend requires a short-lived, single-use verification token for registration and password resets.

New customer accounts receive a unique `C`-prefixed numeric UID, and new salon-owner accounts receive a unique `S`-prefixed numeric UID. A sparse unique MongoDB index enforces uniqueness, and collisions are retried; existing customer and owner accounts are backfilled during database startup. UIDs are omitted from ordinary account responses, shown to admins in customer, salon-owner, and booking records/searches, and included in customer and salon-owner booking histories.

The admin tab includes separate Customers, Salons & services, and Bookings sections. Customer search matches partial UID, name, email, phone, and location text. Salon search matches partial salon name, owner UID/name/email, city, address, PIN code, service name, and category; matching an owner returns their full salon records. Salon-owner UID/name/email and owner account timestamps are shown directly on each salon record with salon account timestamps and open/closed, active/blocked, and approval statuses. Booking records can be filtered by booking-created date range, status, customer, and salon; the customer and salon selectors provide searchable, alphabetically sorted options and include account UIDs for lookup. Report salon and customer selectors are also searchable and alphabetically sorted; report periods include today, this week (Monday through the current day in UTC), this month, and this year, and the same period and filters apply to CSV exports. Report salon, customer, and service filters can be combined; each “All …” option clears only that filter, and “Clear filters” resets all report dimensions while preserving the selected date period. Admins can update non-admin account and salon details, block or unblock accounts/salons, and create customer/owner accounts and salons. Deleting a salon profile requires two confirmations; its booking, order, and payment-history records remain, with a salon snapshot retained for history and reporting. Customer accounts with booking or ownership history cannot be permanently deleted. New admin-created accounts must use Forgot password to set their own password. Booking management allows FIFO service start and completion. Admins can confirm a manual UPI advance only after checking the bank transaction, or reject an unverified reference and cancel that pending booking; neither action processes an automatic bank refund. Admin roles and the signed-in admin account are protected from editing or blocking.

Signed-in customers can send an email message to a salon owner from the salon panel, and salon owners can email customers from the live booking queue. Delivery uses the backend Gmail settings (`GMAIL_USER`, `GMAIL_APP_PASSWORD`, and optionally `EMAIL_FROM`); a message is sent only to the registered account associated with that salon or booking. OTP verification and password-reset emails, direct messages, and queue-rejection notices use branded HTML layouts with plain-text alternatives. Queue-rejection feedback links use the first configured `FRONTEND_URL` origin and expire after 30 days.

Salon-owner profiles open a salon management page instead of customer personal details. Owners can create salon profiles, edit salon contact/location details, and add, update, or remove services and prices. Location forms accept manually entered latitude and longitude and an optional area PIN code; the “Use my current location” button fills the coordinates using browser geolocation only. Customer and admin location forms use the same coordinate entry behavior. New salon profiles still require admin approval before appearing in discovery.

Customers choose an appointment date (today or a future date) when reserving. Future-dated bookings are kept out of the live queue until that day in the customer's selected timezone. Customer, salon-owner, and admin booking histories show the appointment date, booking timestamp, and current status.

Standard bookings are ordered FIFO by their database-assigned salon sequence. Express bookings take priority over waiting standard bookings, but do not interrupt a customer already in service. The server fixes UPI advances at ₹1 for standard and ₹25 for express; selected service prices are snapshotted at booking time and due at the salon. At most two active or pending-payment bookings are allowed per account across the platform.

## Validation

Run backend tests with `cd backend; npm test` and create the frontend production bundle with `cd frontend; npm run build`.

The API persists user, salon, OTP, and booking state in MongoDB. The built-in IP rate limiter is process-local; use a shared Redis-backed store before horizontally scaling the API. Configure backups, monitoring, payment reconciliation, privacy/retention policies, and production abuse controls before a public launch.
