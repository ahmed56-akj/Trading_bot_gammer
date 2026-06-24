# AK Trading Bot 🤖

Telegram trading signal bot — BTC/USDT analysis with TP1, TP2, TP3 & SL.

## Setup

### 1. Telegram Bot Token
- @BotFather pe jao Telegram mein
- `/newbot` likho
- Name do: `AK Trading Bot`
- Token copy karo

### 2. Chat ID lena
- Apne bot ko message karo `/start`
- Browser mein kholo: `https://api.telegram.org/bot<TOKEN>/getUpdates`
- `chat.id` copy karo

### 3. .env file update karo
```
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CHAT_ID=987654321
TRADING_PAIR=BTCUSDT
INTERVAL=15m
SIGNAL_INTERVAL_MINUTES=15
```

### 4. Run karo
```bash
npm install
node index.js
```

## Commands
| Command | Kaam |
|---------|------|
| /start | Welcome message |
| /signal | Manual signal abhi |
| /price | Live BTC price |
| /status | Bot status |

## Signal Logic
- **RSI 14** — Overbought/Oversold
- **EMA 9/21/50** — Trend direction  
- **MACD 12/26/9** — Momentum & crossover
- **Bollinger Bands** — Volatility squeeze
- **ATR** — TP/SL calculation
- **Volume** — Confirmation

## Pair Change karna
.env mein TRADING_PAIR=ETHUSDT karo any Binance pair works.
