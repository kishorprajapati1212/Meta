import { COUNTRIES } from '../assets/worldMap'

/**
 * countries.js — name ↔ code resolution for the audience maps.
 *
 * Upstreams disagree about how they identify a country: the YouTube Analytics
 * API and Instagram send ISO 3166-1 alpha-2 codes, Search Console sends
 * display names ("India"), and some send legacy variants ("United States",
 * "USA", "U.K."). This module makes the map join work regardless.
 */

const NAME_INDEX = new Map()
const CODE_INDEX = new Map()

for (const c of COUNTRIES) {
  if (!c.id) continue
  CODE_INDEX.set(c.id, c.name)
  const n = c.name.toLowerCase()
  NAME_INDEX.set(n, c.id)
}

// Aliases the upstreams actually send.
const ALIASES = {
  'usa': 'US', 'united states': 'US', 'united states of america': 'US', 'us': 'US',
  'uk': 'GB', 'united kingdom': 'GB', 'great britain': 'GB', 'england': 'GB',
  'uae': 'AE', 'united arab emirates': 'AE',
  'russia': 'RU', 'russian federation': 'RU',
  'south korea': 'KR', 'korea, republic of': 'KR', 'korea': 'KR',
  'north korea': 'KP',
  'vietnam': 'VN', 'viet nam': 'VN',
  'iran': 'IR', 'iran, islamic republic of': 'IR',
  'syria': 'SY', 'syrian arab republic': 'SY',
  'venezuela': 'VE', 'venezuela, bolivarian republic of': 'VE',
  'bolivia': 'BO', 'bolivia, plurinational state of': 'BO',
  'tanzania': 'TZ', 'tanzania, united republic of': 'TZ',
  'moldova': 'MD', 'moldova, republic of': 'MD',
  'laos': 'LA', "lao people's democratic republic": 'LA',
  'macau': 'MO', 'macao': 'MO',
  'taiwan': 'TW', 'taiwan, province of china': 'TW',
  'hong kong': 'HK', 'hong kong sar': 'HK',
  'czech republic': 'CZ', 'czechia': 'CZ',
  'turkey': 'TR', 'türkiye': 'TR',
  'ivory coast': 'CI', "côte d'ivoire": 'CI',
  'democratic republic of the congo': 'CD', 'dr congo': 'CD',
  'republic of the congo': 'CG',
  'dominican republic': 'DO',
  'saudi arabia': 'SA',
  'new zealand': 'NZ',
  'south africa': 'ZA',
  'sri lanka': 'LK',
  'bangladesh': 'BD',
  'pakistan': 'PK',
  'nepal': 'NP',
  'myanmar': 'MM', 'burma': 'MM',
  'cambodia': 'KH',
  'philippines': 'PH',
  'indonesia': 'ID',
  'malaysia': 'MY',
  'singapore': 'SG',
  'thailand': 'TH',
  'japan': 'JP',
  'china': 'CN',
  'india': 'IN',
  'australia': 'AU',
  'canada': 'CA',
  'mexico': 'MX',
  'brazil': 'BR',
  'germany': 'DE',
  'france': 'FR',
  'spain': 'ES',
  'italy': 'IT',
  'netherlands': 'NL',
  'belgium': 'BE',
  'switzerland': 'CH',
  'austria': 'AT',
  'poland': 'PL',
  'sweden': 'SE',
  'norway': 'NO',
  'denmark': 'DK',
  'finland': 'FI',
  'ireland': 'IE',
  'portugal': 'PT',
  'greece': 'GR',
  'israel': 'IL',
  'egypt': 'EG',
  'nigeria': 'NG',
  'kenya': 'KE',
  'morocco': 'MA',
  'argentina': 'AR',
  'chile': 'CL',
  'colombia': 'CO',
  'peru': 'PE',
}

for (const [alias, code] of Object.entries(ALIASES)) NAME_INDEX.set(alias, code)

export function codeOf(nameOrCode) {
  if (!nameOrCode) return null
  const s = String(nameOrCode).trim()
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase()
  const direct = NAME_INDEX.get(s.toLowerCase())
  if (direct) return direct
  // Fall back to the Natural Earth display name.
  return NAME_INDEX.get(s.toLowerCase()) || null
}

export function nameOf(codeOrName) {
  if (!codeOrName) return ''
  const code = CODE_INDEX.has(String(codeOrName).toUpperCase()) ? String(codeOrName).toUpperCase() : codeOf(codeOrName)
  return code ? CODE_INDEX.get(code) || String(codeOrName) : String(codeOrName)
}

export const COUNTRY_NAMES = { codeOf, nameOf, nameToCode: codeOf }

/** Flag emoji from an alpha-2 code — cheap, dependency-free, always renders. */
export function flagOf(code) {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '🌐'
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
