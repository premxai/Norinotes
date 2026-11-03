# Full job collection run

Status: finished this session, 86 candidates still pending (rerun to continue).
Started 2026-11-03T06:39:06.294Z; written 2026-11-03T11:34:51.050Z; active run time 4 h 42 min (sum over restarts).

One verification read per candidate company of the registry (imported from the seed lists), with the existing connectors and `pollBoard`: our User-Agent, per-host-group concurrency from the connector capabilities, robots.txt (Disallow and Crawl-delay) obeyed on every request, ETag stored for the next poll, back-off on 429/503 and on runs of 401/403, 3-day probation and dead statuses per `docs/job-collection.md`. A job closes only after two complete reads miss it, so a first read closes nothing. No AI calls. Produced by `scripts/collect-all.mts`.

| System | Candidates | Live | Empty | Dead | Blocked | Pending | Open jobs | Posted last 60 d | Median jobs / live board | Run time |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ashby | 3929 | 3241 | 392 | 296 | 0 | 0 | 59824 | 32548 | 8 | 1 h 13 min |
| bamboohr | 5632 | 2670 | 2440 | 522 | 0 | 0 | 1990 | 1123 | 4 | 1 h 6 min |
| breezy | 2549 | 1904 | 519 | 126 | 0 | 0 | 37204 | 20195 | 4 | 48 min |
| greenhouse | 7199 | 5859 | 754 | 586 | 0 | 0 | 200709 | 95537 | 9 | 1 h 26 min |
| icims | 1783 | 1212 | 144 | 62 | 355 | 10 | 63049 | 23486 | 29 | 2 h 40 min |
| lever | 2470 | 1960 | 411 | 99 | 0 | 0 | 68581 | 25955 | 9 | 1 h 11 min |
| oracle | 1270 | 1188 | 66 | 1 | 2 | 13 | 202586 | 143317 | 70 | 48 min |
| personio | 2463 | 1144 | 206 | 601 | 512 | 0 | 8561 | 2567 | 4 | 43 min |
| pinpoint | 406 | 283 | 53 | 5 | 65 | 0 | 9288 | 0 | 9 | 8 min |
| recruitee | 2659 | 2404 | 178 | 72 | 0 | 5 | 37052 | 14639 | 6 | 4 h 3 min |
| rippling | 1923 | 1273 | 410 | 240 | 0 | 0 | 13241 | 6155 | 5 | 18 min |
| teamtailor | 2761 | 2282 | 252 | 224 | 0 | 3 | 34309 | 19486 | 7 | 46 min |
| workable | 4751 | 2515 | 2187 | 49 | 0 | 0 | 75276 | 34584 | 8 | 56 min |
| workday | 3530 | 3265 | 128 | 50 | 32 | 55 | 518750 | 505117 | 54 | 1 h 50 min |
| **Total** | 43325 | 31200 | 8140 | 2933 | 966 | 86 | 1330420 | 924709 | | 4 h 42 min |

Columns: **Live** is an active board with at least one open job; **Empty** an active board with none; **Dead** a board that is not found (HTTP 404, or the tenant host does not resolve); **Blocked** a board disabled because its host answered 401/403 or robots.txt disallows the feed; **Pending** a candidate whose reads kept failing (see errors) or that was not reached yet. **Posted last 60 d** counts open jobs whose feed gives a `posted_at` within 60 days; 47817 open jobs have no posting date in their feed. Run time is the time the system still had boards in flight or queued, summed over restarts.

Skipped systems:
- smartrecruiters: not polled, robots.txt disallows every path for our User-Agent.

## Top error kinds

Error events during the run (every failed attempt counts, including ones a retry later fixed):

| Kind | Events |
|---|---:|
| robots-disallowed | 922 |
| rate-limited-429 | 537 |
| network-UND_ERR_CONNECT_TIMEOUT | 517 |
| http-500 | 152 |
| timeout | 131 |
| rate-limited-503 | 111 |
| blocked-by-host-403 | 31 |
| robots-unavailable | 26 |
| other:Error | 18 |
| incomplete-read | 11 |
| dns-failure-unconfirmed | 10 |
| network-EAI_AGAIN | 10 |
| tls | 7 |
| dns-not-found | 6 |
| http-403 | 5 |

Final reasons on boards that are not live (candidate = still pending, disabled, dead):

| Reason | Status | Boards |
|---|---|---:|
| board not found | dead | 2927 |
| disallowed by robots.txt | disabled | 932 |
| error:http-500 | candidate | 54 |
| blocked by host (403) | disabled | 31 |
| error:rate-limited-503 | candidate | 11 |
| error:other | candidate | 8 |
| host not found (DNS, confirmed by 1.1.1.1 and 8.8.8.8) | dead | 6 |
| error:incomplete-read | candidate | 4 |
| blocked by host (401) | disabled | 3 |
| error:http-403 | candidate | 3 |
| error:network-ECONNRESET | candidate | 1 |
| error:network-ERR_TLS_CERT_ALTNAME_INVALID | candidate | 1 |
| error:tls | candidate | 1 |
| error:http-400 | candidate | 1 |

Host back-offs (a pause of 2, 4, 8 or 16+ minutes for a host group that refused us):

- workday: 40 pause(s)
- oracle: 43 pause(s)
- icims: 3 pause(s)
- workable: 6 pause(s)
- recruitee: 82 pause(s)
- icims: 2 boards left for the next run

## Resume

```
npx tsx scripts/collect-all.mts --db data\collect-full
```

A rerun takes only the boards that are still candidates (never verified, or last attempt failed) and keeps the counters above.
