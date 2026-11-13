# Turnup

Find the move in your city. Turnup is an events and ticketing platform: guests discover concerts, parties, food
festivals and more, see which friends are going and buy tickets in seconds; hosts sell tickets and check guests in
at the door with QR codes.

> Work in progress. Phases 1 to 3 of 7 are complete: browsing, event and host pages, saving, following, ticket checkout and seat-safe sales.

## Stack

| Layer | Technology |
| --- | --- |
| Front end | React 18, React Router 7, Vite |
| Back end | Node.js, Express (ES modules) |
| Database | MySQL 8 (MariaDB 10.6+ also works) |
| Auth | JWT in an httpOnly cookie, bcrypt password hashing, role-based access |

## Features so far

- 28 sample events from 10 hosts across Lagos, Abuja and Ibadan, with real event photos
- Browse by city, category and date (today, this weekend, next 7 days), free events only, and search
- Date windows follow Lagos time, so "this weekend" means Friday 5pm to Sunday night wherever the server runs
- "Your friends are going" on every card and event page
- Event pages with a live countdown, ticket types with early-bird deadlines and tickets left
- Host pages with follower counts and upcoming events, plus follow and unfollow
- Save events to a personal list
- Ticket checkout: choose ticket types and quantities, apply promo codes, then pay with Paystack (or built-in test payments)
- Free RSVPs confirmed instantly, group tickets and tables that admit several people, early-bird prices that end on a date
- Prices, discounts and booking fees are always worked out on the server; the browser only sends ticket types and quantities
- Tickets are issued exactly once per payment, however many times Paystack or the buyer's browser reports it
- My tickets: festival-style passes with a QR code each, for upcoming and past events
- Accounts with login protection (rate limiting, same error for wrong email or password, cross-site request blocking)

## Seat-safe ticket sales

When a big show goes on sale, hundreds of people hit "Get tickets" in the same second. Turnup holds tickets for
10 minutes at checkout and can never oversell, even then.

- **Holding is one atomic step.** `UPDATE ticket_tiers SET held = held + n WHERE id = ? AND sold + held + n <= quantity`.
  The database checks and changes the row while it is locked, so two buyers can never both take the last ticket.
  A `CHECK (sold + held <= quantity)` constraint backs it up at the database level.
- **Abandoned checkouts go back on sale.** Unpaid holds expire after 10 minutes. A sweeper runs every 30 seconds
  (and before anything that reads stock) using `FOR UPDATE SKIP LOCKED`, so it never blocks or fights with an order
  that is being paid at that moment. Buyers can also cancel and release tickets straight away.
- **Payments are confirmed exactly once.** The order row is locked, held tickets become sold, and tickets are issued.
  A payment that arrives after the hold ended still succeeds if tickets are left, and fails with a refund message if not.
- **Promo codes with limited uses** are reserved the same way, so a 5-use code is never used 6 times.
- **Deadlocks are retried.** Ticket types are always locked in the same order, and if the database still picks a
  transaction as a deadlock loser it is retried, which is the standard way to handle them.

`npm run load-test` (in `server`) proves it against the real API and database. Latest run:

| | Result |
| --- | --- |
| Buyers rushing at once | 500, wanting 652 tickets for 100 places |
| Throughput | 388 requests a second on a small cloud machine |
| Oversold | **0** (100 sold of 100) |
| Tickets issued vs paid | 100 issued for 100 paid, none twice |
| Buyers charged without tickets | 0 |
| Abandoned holds resold | 18 of 18 picked up by people who retried |
| Naive "check, then update" with the same rush | **oversold by 552 tickets** |

Full output: [docs/load-test-results.md](docs/load-test-results.md). Try a bigger run with `npm run load-test -- 1000 150`.

## Design

"Sunset pop": warm cream, hot orange and cobalt with a sunshine-yellow accent, set in Bricolage Grotesque.

## Run it locally

You need Node 20+ and MySQL.

```bash
# 1. Create a database and user (in the mysql shell)
CREATE DATABASE turnup CHARACTER SET utf8mb4;
CREATE USER 'turnup'@'localhost' IDENTIFIED BY 'choose-a-password';
GRANT ALL ON turnup.* TO 'turnup'@'localhost';

# 2. Configure the server
cp server/.env.example server/.env    # then set DB_PASSWORD

# 3. Install everything and load sample events
npm run setup

# 4. Start both apps (two terminals)
npm run dev:server    # API on http://localhost:5060
npm run dev:client    # site on http://localhost:5175
```

Every sample account uses the password `turnup123`: `guest@turnup.demo` (has friends going to events) and
`host@turnup.demo` (runs Afterdark Collective). Promo codes to try: `AFTERDARK`, `WATERFRONT10`, `FOODIE15` and `LAUGH50`. Running `npm run db:setup` again moves the sample events back into
the coming weeks, so they never go out of date.

## Tests

```bash
npm test
```

## Roadmap

1. ~~Foundation: accounts, events, hosts, browsing, saving and following~~
2. ~~Tickets: checkout with Paystack, free RSVPs, promo codes and group tickets~~
3. ~~Seat-safe sales: 10-minute holds and no overselling under heavy load, with a load test~~
4. QR tickets and door check-in
5. Host dashboard: create events, ticket types, sales and co-hosts
6. Live check-in dashboard
7. Demo mode, screenshots and launch

## Photo credits

Event photos are from [Pexels](https://www.pexels.com) and used under the [Pexels licence](https://www.pexels.com/license/).
Each file in `client/public/img/events` is named after its Pexels photo ID; the original is at `https://www.pexels.com/photo/<id>/`.

---

**Author:** Ayomikunle Daramola · [LinkedIn](https://www.linkedin.com/in/ayomikunle-daramola-95b738260/)
