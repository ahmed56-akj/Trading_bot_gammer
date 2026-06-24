require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { RSI, MACD, EMA, BollingerBands } = require('technicalindicators');
const cron = require('node-cron');

// ─── CONFIG ───────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const INTERVAL  = process.env.INTERVAL || '15m';
const CRON_MIN  = process.env.SIGNAL_INTERVAL_MINUTES || '15';

// ─── 16 COINS LIST ────────────────────────────────────────
const COINS = [
  { symbol: 'BTCUSDT',  name: 'Bitcoin',   emoji: '₿'  },
  { symbol: 'ETHUSDT',  name: 'Ethereum',  emoji: '⟠'  },
  { symbol: 'BNBUSDT',  name: 'BNB',       emoji: '🔶' },
  { symbol: 'SOLUSDT',  name: 'Solana',    emoji: '◎'  },
  { symbol: 'XRPUSDT',  name: 'XRP',       emoji: '✕'  },
  { symbol: 'ADAUSDT',  name: 'Cardano',   emoji: '₳'  },
  { symbol: 'DOGEUSDT', name: 'Dogecoin',  emoji: '🐕' },
  { symbol: 'DOTUSDT',  name: 'Polkadot',  emoji: '●'  },
  { symbol: 'AVAXUSDT', name: 'Avalanche', emoji: '🔺' },
  { symbol: 'MATICUSDT',name: 'Polygon',   emoji: '🟣' },
  { symbol: 'LINKUSDT', name: 'Chainlink', emoji: '⬡'  },
  { symbol: 'LTCUSDT',  name: 'Litecoin',  emoji: 'Ł'  },
  { symbol: 'UNIUSDT',  name: 'Uniswap',   emoji: '🦄' },
  { symbol: 'ATOMUSDT', name: 'Cosmos',    emoji: '⚛'  },
  { symbol: 'NEARUSDT', name: 'NEAR',      emoji: '🌐' },
  { symbol: 'ARBUSDT',  name: 'Arbitrum',  emoji: '🔵' },
];

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── FETCH CANDLES ────────────────────────────────────────
async function getCandles(symbol, interval, limit = 100) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const { data } = await axios.get(url);
  return data.map(c => ({
    open:   parseFloat(c[1]),
    high:   parseFloat(c[2]),
    low:    parseFloat(c[3]),
    close:  parseFloat(c[4]),
    volume: parseFloat(c[5]),
  }));
}

// ─── INDICATORS ───────────────────────────────────────────
function calcIndicators(candles) {
  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  const rsiArr   = RSI.calculate({ values: closes, period: 14 });
  const ema9Arr  = EMA.calculate({ values: closes, period: 9  });
  const ema21Arr = EMA.calculate({ values: closes, period: 21 });
  const ema50Arr = EMA.calculate({ values: closes, period: 50 });
  const macdArr  = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
  const bbArr    = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });

  const volAvg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;

  const trArr = [];
  for (let i = 1; i < candles.length; i++) {
    trArr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1])
    ));
  }
  const atr = trArr.slice(-14).reduce((a, b) => a + b, 0) / 14;

  return {
    rsi:        rsiArr[rsiArr.length - 1],
    ema9:       ema9Arr[ema9Arr.length - 1],
    ema21:      ema21Arr[ema21Arr.length - 1],
    ema50:      ema50Arr[ema50Arr.length - 1],
    macdLatest: macdArr[macdArr.length - 1],
    macdPrev:   macdArr[macdArr.length - 2],
    bbLatest:   bbArr[bbArr.length - 1],
    volAvg,
    volNow:     volumes[volumes.length - 1],
    atr,
  };
}

// ─── SIGNAL GENERATOR ─────────────────────────────────────
function generateSignal(candles) {
  const ind   = calcIndicators(candles);
  const price = candles[candles.length - 1].close;
  const { rsi, ema9, ema21, ema50, macdLatest, macdPrev, bbLatest, volAvg, volNow, atr } = ind;

  let buyScore = 0, sellScore = 0;

  // RSI
  if (rsi < 35)      buyScore  += 2;
  else if (rsi < 45) buyScore  += 1;
  if (rsi > 65)      sellScore += 2;
  else if (rsi > 55) sellScore += 1;

  // EMA trend
  if (ema9 > ema21 && ema21 > ema50) buyScore  += 2;
  if (ema9 < ema21 && ema21 < ema50) sellScore += 2;
  if (price > ema9) buyScore  += 1;
  if (price < ema9) sellScore += 1;

  // MACD
  if (macdLatest && macdPrev) {
    const up   = macdPrev.MACD < macdPrev.signal && macdLatest.MACD > macdLatest.signal;
    const down = macdPrev.MACD > macdPrev.signal && macdLatest.MACD < macdLatest.signal;
    if (up)   buyScore  += 3;
    if (down) sellScore += 3;
    if (macdLatest.histogram > 0) buyScore  += 1;
    if (macdLatest.histogram < 0) sellScore += 1;
  }

  // Bollinger
  if (bbLatest) {
    if (price <= bbLatest.lower) buyScore  += 2;
    if (price >= bbLatest.upper) sellScore += 2;
  }

  // Volume
  if (volNow > volAvg * 1.5) {
    if (buyScore  > sellScore) buyScore  += 1;
    if (sellScore > buyScore)  sellScore += 1;
  }

  let direction = 'HOLD';
  let score     = 0;

  if (buyScore > sellScore && buyScore >= 4)       { direction = 'BUY';  score = buyScore;  }
  else if (sellScore > buyScore && sellScore >= 4) { direction = 'SELL'; score = sellScore; }
  else return null;

  let strength, stars;
  if (score >= 8)      { strength = 'STRONG';   stars = '⭐⭐⭐'; }
  else if (score >= 6) { strength = 'MODERATE'; stars = '⭐⭐';  }
  else                 { strength = 'WEAK';     stars = '⭐';   }

  let tp1, tp2, tp3, sl;
  if (direction === 'BUY') {
    tp1 = +(price + atr * 1.0).toFixed(4);
    tp2 = +(price + atr * 2.0).toFixed(4);
    tp3 = +(price + atr * 3.5).toFixed(4);
    sl  = +(price - atr * 1.2).toFixed(4);
  } else {
    tp1 = +(price - atr * 1.0).toFixed(4);
    tp2 = +(price - atr * 2.0).toFixed(4);
    tp3 = +(price - atr * 3.5).toFixed(4);
    sl  = +(price + atr * 1.2).toFixed(4);
  }

  const rr = (Math.abs(tp2 - price) / Math.abs(price - sl)).toFixed(2);

  return {
    direction, strength, stars, score,
    entry: price, tp1, tp2, tp3, sl, rr,
    rsi: rsi.toFixed(1),
    ema9: ema9.toFixed(4), ema21: ema21.toFixed(4), ema50: ema50.toFixed(4),
    macdHist: macdLatest ? macdLatest.histogram.toFixed(5) : 'N/A',
    volRatio: (volNow / volAvg).toFixed(2),
    bbUpper: bbLatest ? bbLatest.upper.toFixed(4) : 'N/A',
    bbLower: bbLatest ? bbLatest.lower.toFixed(4) : 'N/A',
  };
}

// ─── FORMAT MESSAGE ───────────────────────────────────────
function formatMessage(signal, coin, interval) {
  const dir   = signal.direction === 'BUY';
  const emoji = dir ? '🟢' : '🔴';
  const arrow = dir ? '📈' : '📉';
  const now   = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });

  // Smart price formatting (BTC=$65000, DOGE=$0.12)
  const fmt = (n) => n >= 1 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : n.toFixed(6);

  return `
${emoji} *${signal.direction} SIGNAL* ${arrow}
${coin.emoji} *${coin.name}* \`${coin.symbol.replace('USDT', '/USDT')}\`
⏰ *Timeframe:* ${interval}
${signal.stars} *Strength:* ${signal.strength}
━━━━━━━━━━━━━━━━━━━━
💰 *Entry:*  \`$${fmt(signal.entry)}\`
🎯 *TP1:*    \`$${fmt(signal.tp1)}\`
🎯 *TP2:*    \`$${fmt(signal.tp2)}\`
🎯 *TP3:*    \`$${fmt(signal.tp3)}\`
🛑 *SL:*     \`$${fmt(signal.sl)}\`
📐 *R/R:*    \`1:${signal.rr}\`
━━━━━━━━━━━━━━━━━━━━
📊 *Indicators*
• RSI(14): \`${signal.rsi}\`
• EMA9/21/50: \`${fmt(+signal.ema9)} / ${fmt(+signal.ema21)} / ${fmt(+signal.ema50)}\`
• MACD Hist: \`${signal.macdHist}\`
• BB: \`${fmt(+signal.bbLower)} — ${fmt(+signal.bbUpper)}\`
• Volume: \`${signal.volRatio}x avg\`
━━━━━━━━━━━━━━━━━━━━
🕐 \`${now} PKT\`
⚠️ _DYOR — Financial advice nahi hai_
`.trim();
}

// ─── SINGLE COIN SCAN ─────────────────────────────────────
async function scanCoin(coin, interval) {
  try {
    const candles = await getCandles(coin.symbol, interval, 100);
    const signal  = generateSignal(candles);
    if (!signal) return null;
    return { signal, coin };
  } catch (err) {
    console.error(`Error scanning ${coin.symbol}:`, err.message);
    return null;
  }
}

// ─── SCAN ALL 16 COINS ────────────────────────────────────
async function runAllSignals() {
  console.log(`\n[${new Date().toISOString()}] Scanning all ${COINS.length} coins...`);

  // Summary header
  const now = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
  await bot.sendMessage(CHAT_ID,
    `🔍 *Market Scan Started*\n📊 Scanning ${COINS.length} coins on ${INTERVAL}...\n🕐 \`${now} PKT\``,
    { parse_mode: 'Markdown' }
  );

  const results   = [];
  const noSignals = [];

  // Scan with small delay to avoid rate limit
  for (const coin of COINS) {
    const result = await scanCoin(coin, INTERVAL);
    if (result) {
      results.push(result);
      // Send individual signal
      const msg = formatMessage(result.signal, result.coin, INTERVAL);
      await bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
      await delay(500); // 0.5s gap between messages
    } else {
      noSignals.push(coin.name);
    }
    await delay(300); // API rate limit
  }

  // Summary footer
  const buySignals  = results.filter(r => r.signal.direction === 'BUY').length;
  const sellSignals = results.filter(r => r.signal.direction === 'SELL').length;
  const strongOnes  = results.filter(r => r.signal.strength === 'STRONG').map(r => r.coin.name);

  let summary = `\n✅ *Scan Complete!*\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━\n`;
  summary += `🟢 Buy Signals:  *${buySignals}*\n`;
  summary += `🔴 Sell Signals: *${sellSignals}*\n`;
  summary += `⚪ No Signal:    *${noSignals.length}*\n`;
  if (strongOnes.length > 0) {
    summary += `━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `⭐⭐⭐ *Strong Signals:*\n${strongOnes.map(n => `• ${n}`).join('\n')}\n`;
  }
  summary += `━━━━━━━━━━━━━━━━━━━━\n`;
  summary += `⏭ Next scan in ${CRON_MIN} min`;

  await bot.sendMessage(CHAT_ID, summary, { parse_mode: 'Markdown' });
  console.log(`Done! Buy: ${buySignals} | Sell: ${sellSignals} | No signal: ${noSignals.length}`);
}

// ─── HELPER ───────────────────────────────────────────────
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ─── TELEGRAM COMMANDS ────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const coinList = COINS.map((c, i) => `${i + 1}. ${c.emoji} ${c.name}`).join('\n');
  await bot.sendMessage(msg.chat.id, `
🤖 *AK Trading Bot — Multi Coin*

📋 *Tracking ${COINS.length} Coins:*
${coinList}

⏰ Auto scan every ${CRON_MIN} min

*Commands:*
/scan    — Abhi sab coins scan karo
/signal  — Specific coin ka signal
/coins   — Coin list
/price   — All prices
/status  — Bot status
/help    — Help
`.trim(), { parse_mode: 'Markdown' });
});

bot.onText(/\/scan/, async (msg) => {
  await bot.sendMessage(msg.chat.id, '⏳ All 16 coins scan ho rahi hain...');
  await runAllSignals();
});

bot.onText(/\/coins/, async (msg) => {
  const list = COINS.map((c, i) => `${i + 1}. ${c.emoji} \`${c.symbol.replace('USDT', '/USDT')}\``).join('\n');
  await bot.sendMessage(msg.chat.id, `📋 *Tracked Coins (${COINS.length}):*\n${list}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/price/, async (msg) => {
  await bot.sendMessage(msg.chat.id, '⏳ Prices fetch ho rahi hain...');
  let text = '💲 *Live Prices*\n━━━━━━━━━━━━━━━━━━━━\n';
  for (const coin of COINS) {
    try {
      const candles = await getCandles(coin.symbol, '1m', 2);
      const price   = candles[candles.length - 1].close;
      const fmt     = price >= 1
        ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : price.toFixed(6);
      text += `${coin.emoji} *${coin.name}:* \`$${fmt}\`\n`;
      await delay(200);
    } catch { text += `${coin.emoji} *${coin.name}:* N/A\n`; }
  }
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/signal(?:\s+(\w+))?/, async (msg, match) => {
  const input = match[1] ? match[1].toUpperCase() : null;
  if (!input) {
    const list = COINS.map(c => `\`${c.name.toLowerCase()}\``).join(', ');
    await bot.sendMessage(msg.chat.id, `Coin name likho:\n/signal bitcoin\n/signal eth\n/signal doge\n\nAvailable: ${list}`, { parse_mode: 'Markdown' });
    return;
  }

  const coin = COINS.find(c =>
    c.symbol.includes(input) ||
    c.name.toLowerCase().includes(input.toLowerCase())
  );

  if (!coin) {
    await bot.sendMessage(msg.chat.id, `❌ Coin nahi mila: ${input}\n/coins se list dekho`);
    return;
  }

  await bot.sendMessage(msg.chat.id, `⏳ ${coin.name} analyze ho raha hai...`);
  const result = await scanCoin(coin, INTERVAL);
  if (!result) {
    await bot.sendMessage(msg.chat.id, `⚪ *${coin.name}:* Koi clear signal nahi abhi. Market sideways hai.`, { parse_mode: 'Markdown' });
    return;
  }
  await bot.sendMessage(msg.chat.id, formatMessage(result.signal, result.coin, INTERVAL), { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
  const uptime = Math.floor(process.uptime() / 60);
  await bot.sendMessage(msg.chat.id, `
✅ *Bot Status: ONLINE*
⏱ Uptime: ${uptime} min
📊 Coins: ${COINS.length}
⏰ Interval: ${INTERVAL}
🔄 Auto Scan: Every ${CRON_MIN} min
`.trim(), { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id, `
📖 *Commands:*
/scan          — Sab 16 coins scan karo
/signal [coin] — Specific coin signal
/price         — All live prices
/coins         — Coin list
/status        — Bot info
/start         — Welcome

Example: \`/signal ethereum\` ya \`/signal btc\`
`.trim(), { parse_mode: 'Markdown' });
});

// ─── CRON — AUTO SCAN ALL 16 COINS ───────────────────────
cron.schedule(`*/${CRON_MIN} * * * *`, runAllSignals);

// ─── START ────────────────────────────────────────────────
console.log(`🤖 AK Trading Bot started!`);
console.log(`📊 Tracking ${COINS.length} coins | Interval: ${INTERVAL}`);
console.log(`⏰ Auto scan every ${CRON_MIN} minutes`);

bot.sendMessage(CHAT_ID,
  `🤖 *AK Trading Bot Online!*\n📊 ${COINS.length} coins tracking on ${INTERVAL}\nType /scan for instant analysis of all coins!`,
  { parse_mode: 'Markdown' }
).catch(err => console.error('Startup msg failed:', err.message));

runAllSignals(); // Immediate scan on start
