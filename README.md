# Turnup

Find the move in your city. Turnup is an events and ticketing platform: guests discover concerts, parties, food
festivals and more, see which friends are going and buy tickets in seconds; hosts sell tickets and check guests in
at the door with QR codes.

> Work in progress. Phase 1 of 7 is complete: browsing, event and host pages, saving and following.

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
- Accounts with login protection (rate limiting, same error for wrong email or password, cross-site request blocking)

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
`host@turnup.demo` (runs Afterdark Collective). Running `npm run db:setup` again moves the sample events back into
the coming weeks, so they never go out of date.

## Tests

```bash
npm test
```

## Roadmap

1. ~~Foundation: accounts, events, hosts, browsing, saving and following~~
2. Tickets: checkout with Paystack, free RSVPs, promo codes and group tickets
3. Seat-safe sales: 10-minute holds and no overselling under heavy load, with a load test
4. QR tickets and door check-in
5. Host dashboard: create events, ticket types, sales and co-hosts
6. Live check-in dashboard
7. Demo mode, screenshots and launch

## Photo credits

Event photos are from [Pexels](https://www.pexels.com) and used under the [Pexels licence](https://www.pexels.com/license/).
Each file in `client/public/img/events` is named after its Pexels photo ID; the original is at `https://www.pexels.com/photo/<id>/`.

---

**Author:** Ayomikunle Daramola · [LinkedIn](https://www.linkedin.com/in/ayomikunle-daramola-95b738260/)
