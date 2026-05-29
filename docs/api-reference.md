# OANDA v20 REST API Quick Reference

## Base URLs
- Demo: `https://api-fxpractice.oanda.com`
- Live: `https://api-fxtrade.oanda.com`

## Authentication
Header: `Authorization: Bearer <API_TOKEN>`

## Endpoints

### Pricing & Data
| Method | Endpoint | Description |
|---|---|---|
| GET | `/v3/instruments/{pair}/candles` | Historical candle data |
| GET | `/v3/accounts/{id}/pricing/stream` | Real-time price stream |
| GET | `/v3/accounts/{id}/instruments` | List available instruments |

### Orders
| Method | Endpoint | Description |
|---|---|---|
| POST | `/v3/accounts/{id}/orders` | Place order (market/limit/stop) |
| GET | `/v3/accounts/{id}/orders` | List orders |
| GET | `/v3/accounts/{id}/pendingOrders` | List pending orders |
| PUT | `/v3/accounts/{id}/orders/{orderID}` | Modify order |
| PUT | `/v3/accounts/{id}/orders/{orderID}/cancel` | Cancel order |

### Trades
| Method | Endpoint | Description |
|---|---|---|
| GET | `/v3/accounts/{id}/trades` | List trades |
| GET | `/v3/accounts/{id}/trades?state=OPEN` | List open trades |
| PUT | `/v3/accounts/{id}/trades/{tradeID}/close` | Close trade |
| PUT | `/v3/accounts/{id}/trades/{tradeID}/orders` | Modify trade TP/SL |

### Positions
| Method | Endpoint | Description |
|---|---|---|
| GET | `/v3/accounts/{id}/positions` | List positions |
| PUT | `/v3/accounts/{id}/positions/{pair}/close` | Close position |

### Account
| Method | Endpoint | Description |
|---|---|---|
| GET | `/v3/accounts` | List accounts |
| GET | `/v3/accounts/{id}` | Account details (balance, NAV, margin) |
| GET | `/v3/accounts/{id}/summary` | Account summary |

## Rate Limits
- REST: 120 requests/second
- Streaming: 20 simultaneous, 2 new connections/second
- Recommended polling: 30 req/sec

## Order Types Supported
Market, MarketIfTouched, Stop, Limit, TakeProfit, StopLoss, TrailingStop

## Order Durations
FOK, IOC, DAY, GTD (no max limit), GTC

## Missing Operations (need loop workaround)
- Close all orders → loop GET /orders then cancel each
- Close all orders on pair → same, filtered by instrument
- Close all trades → loop GET /trades then close each
- Stale order rejection → code-level timestamp check
