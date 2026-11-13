# Turnup load test

500 buyers want 652 tickets. There are 100.
Database: 10.11.14-MariaDB-0ubuntu0.24.04.1

## Round 1: everyone clicks "Get tickets" at the same moment
- 500 requests in 1.29s (388 a second)
- 76 got a 10-minute hold, 424 were told it sold out, 0 errors
- Response time: median 812 ms, 95th percentile 1165 ms
- Tickets held: 100 of 100

## Round 2: winners pay, some walk away
- 58 paid at the same time in 0.20s, all confirmed: yes
- 18 walked away; after 10 minutes their 18 holds went back on sale

## Round 3: people who missed out try again
- 15 of 424 picked up the released tickets and paid

## Checks
- PASS  Never oversold (100 sold of 100)
- PASS  Sold out completely (no tickets lost) (100 sold, 0 still held)
- PASS  Every paid ticket was issued exactly once (100 tickets issued for 100 paid)
- PASS  Nobody paid for tickets they did not get (0 failed paid orders)
- PASS  No server errors (0 errors)

## Without holds: the naive "check, then update" approach
- Same 500 buyers: 500 were told they had tickets and 652 tickets were sold for 100 places
- Oversold by 552 tickets: real people would be turned away at the door

All checks passed.

_Run on 2026-11-13 with `npm run load-test -- 500 100`._
