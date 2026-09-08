/**
 * Seed set of tradable instruments and their contract conventions.
 *
 * These are sane, widely-used defaults (roughly what MT5/MT4 "Standard"
 * accounts and cTrader show out of the box) — NOT guaranteed to match any
 * specific broker. cTrader and MT5 brokers frequently differ on pip
 * definition, contract size, and digits for the same symbol (e.g. some
 * brokers quote 2-digit JPY pairs, some quote XAUUSD with a 10 oz lot,
 * crypto CFDs vary wildly). Treat every row here as an editable default:
 * a real journal should let the user override these per-account/broker.
 *
 * Conventions used below:
 * - `pipSize` is the price movement that equals "1 pip" for that symbol,
 *   used to convert a raw price delta into the pip count traders think in.
 * - `digits` is the number of decimal places the broker quotes the symbol
 *   with (this is what determines whether a pip is the 4th or 2nd decimal).
 * - `contractSize` is the number of base-currency (or index/commodity)
 *   units in one standard lot (volume = 1.0).
 */

export type SeedInstrument = {
  symbol: string;
  displayName: string;
  pipSize: string; // kept as string to feed straight into Prisma Decimal fields
  contractSize: string;
  digits: number;
  baseCurrency: string | null;
  quoteCurrency: string;
  assetClass: "FX" | "METAL" | "INDEX" | "CRYPTO" | "ENERGY";
};

// --- FX majors ---------------------------------------------------------
// 5-digit ("fractional pip") quoting: price moves in increments of
// 0.00001, but a "pip" is still the 4th decimal (0.0001) by convention —
// except JPY crosses, which are quoted with 3 digits and a pip is the
// 2nd decimal (0.01). Contract size is a standard 100,000-unit lot.
const majors: SeedInstrument[] = [
  {
    symbol: "EURUSD",
    displayName: "Euro / US Dollar",
    pipSize: "0.0001",
    contractSize: "100000",
    digits: 5,
    baseCurrency: "EUR",
    quoteCurrency: "USD",
    assetClass: "FX",
  },
  {
    symbol: "GBPUSD",
    displayName: "British Pound / US Dollar",
    pipSize: "0.0001",
    contractSize: "100000",
    digits: 5,
    baseCurrency: "GBP",
    quoteCurrency: "USD",
    assetClass: "FX",
  },
  {
    symbol: "USDJPY",
    displayName: "US Dollar / Japanese Yen",
    pipSize: "0.01",
    contractSize: "100000",
    digits: 3,
    baseCurrency: "USD",
    quoteCurrency: "JPY",
    assetClass: "FX",
  },
  {
    symbol: "USDCHF",
    displayName: "US Dollar / Swiss Franc",
    pipSize: "0.0001",
    contractSize: "100000",
    digits: 5,
    baseCurrency: "USD",
    quoteCurrency: "CHF",
    assetClass: "FX",
  },
  {
    symbol: "USDCAD",
    displayName: "US Dollar / Canadian Dollar",
    pipSize: "0.0001",
    contractSize: "100000",
    digits: 5,
    baseCurrency: "USD",
    quoteCurrency: "CAD",
    assetClass: "FX",
  },
  {
    symbol: "AUDUSD",
    displayName: "Australian Dollar / US Dollar",
    pipSize: "0.0001",
    contractSize: "100000",
    digits: 5,
    baseCurrency: "AUD",
    quoteCurrency: "USD",
    assetClass: "FX",
  },
  {
    symbol: "NZDUSD",
    displayName: "New Zealand Dollar / US Dollar",
    pipSize: "0.0001",
    contractSize: "100000",
    digits: 5,
    baseCurrency: "NZD",
    quoteCurrency: "USD",
    assetClass: "FX",
  },
];

// --- FX crosses ---------------------------------------------------------
// Same pip/digit rules as majors: JPY-quoted crosses get pipSize 0.01 /
// 3 digits, everything else gets pipSize 0.0001 / 5 digits.
const crosses: SeedInstrument[] = [
  {
    symbol: "EURGBP",
    displayName: "Euro / British Pound",
    pipSize: "0.0001",
    contractSize: "100000",
    digits: 5,
    baseCurrency: "EUR",
    quoteCurrency: "GBP",
    assetClass: "FX",
  },
  {
    symbol: "EURJPY",
    displayName: "Euro / Japanese Yen",
    pipSize: "0.01",
    contractSize: "100000",
    digits: 3,
    baseCurrency: "EUR",
    quoteCurrency: "JPY",
    assetClass: "FX",
  },
  {
    symbol: "GBPJPY",
    displayName: "British Pound / Japanese Yen",
    pipSize: "0.01",
    contractSize: "100000",
    digits: 3,
    baseCurrency: "GBP",
    quoteCurrency: "JPY",
    assetClass: "FX",
  },
  {
    symbol: "EURAUD",
    displayName: "Euro / Australian Dollar",
    pipSize: "0.0001",
    contractSize: "100000",
    digits: 5,
    baseCurrency: "EUR",
    quoteCurrency: "AUD",
    assetClass: "FX",
  },
  {
    symbol: "AUDJPY",
    displayName: "Australian Dollar / Japanese Yen",
    pipSize: "0.01",
    contractSize: "100000",
    digits: 3,
    baseCurrency: "AUD",
    quoteCurrency: "JPY",
    assetClass: "FX",
  },
  {
    symbol: "CADJPY",
    displayName: "Canadian Dollar / Japanese Yen",
    pipSize: "0.01",
    contractSize: "100000",
    digits: 3,
    baseCurrency: "CAD",
    quoteCurrency: "JPY",
    assetClass: "FX",
  },
  {
    symbol: "CHFJPY",
    displayName: "Swiss Franc / Japanese Yen",
    pipSize: "0.01",
    contractSize: "100000",
    digits: 3,
    baseCurrency: "CHF",
    quoteCurrency: "JPY",
    assetClass: "FX",
  },
  {
    symbol: "EURCHF",
    displayName: "Euro / Swiss Franc",
    pipSize: "0.0001",
    contractSize: "100000",
    digits: 5,
    baseCurrency: "EUR",
    quoteCurrency: "CHF",
    assetClass: "FX",
  },
  {
    symbol: "GBPAUD",
    displayName: "British Pound / Australian Dollar",
    pipSize: "0.0001",
    contractSize: "100000",
    digits: 5,
    baseCurrency: "GBP",
    quoteCurrency: "AUD",
    assetClass: "FX",
  },
];

// --- Metals ---------------------------------------------------------
// Quoted in USD per troy ounce. XAUUSD: pip = $0.01, one standard lot is
// 100 oz. XAGUSD: pip = $0.001, one standard lot is 5,000 oz — brokers
// vary a lot here (some use 1,000 oz), so treat this as a default.
const metals: SeedInstrument[] = [
  {
    symbol: "XAUUSD",
    displayName: "Gold / US Dollar",
    pipSize: "0.01",
    contractSize: "100",
    digits: 2,
    baseCurrency: "XAU",
    quoteCurrency: "USD",
    assetClass: "METAL",
  },
  {
    symbol: "XAGUSD",
    displayName: "Silver / US Dollar",
    pipSize: "0.001",
    contractSize: "5000",
    digits: 3,
    baseCurrency: "XAG",
    quoteCurrency: "USD",
    assetClass: "METAL",
  },
];

// --- Indices ---------------------------------------------------------
// CFD indices: "pip" is conventionally 1 full index point, contract size
// is 1 unit per lot (i.e. P&L = points moved × lot size), and digits vary
// by broker's quoting precision (whole points vs. 1-2 decimals).
const indices: SeedInstrument[] = [
  {
    symbol: "US30",
    displayName: "Dow Jones 30",
    pipSize: "1",
    contractSize: "1",
    digits: 1,
    baseCurrency: null,
    quoteCurrency: "USD",
    assetClass: "INDEX",
  },
  {
    symbol: "NAS100",
    displayName: "Nasdaq 100",
    pipSize: "1",
    contractSize: "1",
    digits: 1,
    baseCurrency: null,
    quoteCurrency: "USD",
    assetClass: "INDEX",
  },
  {
    symbol: "SPX500",
    displayName: "S&P 500",
    pipSize: "1",
    contractSize: "1",
    digits: 2,
    baseCurrency: null,
    quoteCurrency: "USD",
    assetClass: "INDEX",
  },
  {
    symbol: "GER40",
    displayName: "Germany 40 (DAX)",
    pipSize: "1",
    contractSize: "1",
    digits: 1,
    baseCurrency: null,
    quoteCurrency: "EUR",
    assetClass: "INDEX",
  },
  {
    symbol: "UK100",
    displayName: "FTSE 100",
    pipSize: "1",
    contractSize: "1",
    digits: 1,
    baseCurrency: null,
    quoteCurrency: "GBP",
    assetClass: "INDEX",
  },
  {
    symbol: "JP225",
    displayName: "Nikkei 225",
    pipSize: "1",
    contractSize: "1",
    digits: 0,
    baseCurrency: null,
    quoteCurrency: "JPY",
    assetClass: "INDEX",
  },
];

// --- Energy ---------------------------------------------------------
// Quoted in USD per barrel. Pip = $0.01, one standard lot is 1,000 barrels.
const energy: SeedInstrument[] = [
  {
    symbol: "USOIL",
    displayName: "Crude Oil (WTI)",
    pipSize: "0.01",
    contractSize: "1000",
    digits: 2,
    baseCurrency: null,
    quoteCurrency: "USD",
    assetClass: "ENERGY",
  },
  {
    symbol: "UKOIL",
    displayName: "Crude Oil (Brent)",
    pipSize: "0.01",
    contractSize: "1000",
    digits: 2,
    baseCurrency: null,
    quoteCurrency: "USD",
    assetClass: "ENERGY",
  },
];

// --- Crypto ---------------------------------------------------------
// Quoted in USD, 1 unit per lot (i.e. "0.10 lots" of BTCUSD = 0.10 BTC).
// Pip is conventionally $0.01, though at crypto price levels most traders
// think in whole-dollar or percentage moves instead.
const crypto: SeedInstrument[] = [
  {
    symbol: "BTCUSD",
    displayName: "Bitcoin / US Dollar",
    pipSize: "0.01",
    contractSize: "1",
    digits: 2,
    baseCurrency: "BTC",
    quoteCurrency: "USD",
    assetClass: "CRYPTO",
  },
  {
    symbol: "ETHUSD",
    displayName: "Ethereum / US Dollar",
    pipSize: "0.01",
    contractSize: "1",
    digits: 2,
    baseCurrency: "ETH",
    quoteCurrency: "USD",
    assetClass: "CRYPTO",
  },
];

export const seedInstruments: SeedInstrument[] = [...majors, ...crosses, ...metals, ...indices, ...energy, ...crypto];
