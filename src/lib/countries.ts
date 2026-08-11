/** ISO 3166-1 alpha-2 → English short name, covering every country seeded
 * in country_regions plus common extras. Unknown codes fall back to the
 * code itself so profile text composition never throws. */
const COUNTRY_NAMES: Record<string, string> = {
  JP: "Japan", KR: "South Korea", CN: "China", MN: "Mongolia", TW: "Taiwan",
  HK: "Hong Kong", PH: "Philippines", ID: "Indonesia", VN: "Vietnam",
  TH: "Thailand", MY: "Malaysia", SG: "Singapore", KH: "Cambodia",
  LA: "Laos", MM: "Myanmar", BN: "Brunei", TL: "Timor-Leste",
  BD: "Bangladesh", IN: "India", PK: "Pakistan", LK: "Sri Lanka",
  NP: "Nepal", BT: "Bhutan", MV: "Maldives", AF: "Afghanistan",
  AU: "Australia", NZ: "New Zealand", PG: "Papua New Guinea", FJ: "Fiji",
  SB: "Solomon Islands", WS: "Samoa", TO: "Tonga", VU: "Vanuatu",
  KI: "Kiribati", FM: "Micronesia", MH: "Marshall Islands", TV: "Tuvalu",
  NR: "Nauru", PW: "Palau",
  US: "United States", CA: "Canada", MX: "Mexico",
  GB: "United Kingdom", DE: "Germany", FR: "France", NL: "Netherlands",
  SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", ES: "Spain",
  IT: "Italy", CH: "Switzerland", IE: "Ireland", BE: "Belgium",
  AT: "Austria", PT: "Portugal", PL: "Poland",
  AE: "United Arab Emirates", SA: "Saudi Arabia", IL: "Israel",
  JO: "Jordan", TR: "Turkey", QA: "Qatar", KW: "Kuwait", OM: "Oman",
  BH: "Bahrain", LB: "Lebanon", IQ: "Iraq",
  KE: "Kenya", NG: "Nigeria", ZA: "South Africa", GH: "Ghana",
  ET: "Ethiopia", TZ: "Tanzania", UG: "Uganda", RW: "Rwanda",
  EG: "Egypt", MA: "Morocco", SN: "Senegal", CI: "Ivory Coast",
  ZM: "Zambia", MW: "Malawi", MZ: "Mozambique",
  BR: "Brazil", AR: "Argentina", CL: "Chile", CO: "Colombia",
  PE: "Peru", EC: "Ecuador", UY: "Uruguay", PY: "Paraguay",
  BO: "Bolivia", GT: "Guatemala", CR: "Costa Rica", PA: "Panama",
  DO: "Dominican Republic", JM: "Jamaica",
  KZ: "Kazakhstan", UZ: "Uzbekistan", KG: "Kyrgyzstan",
  TJ: "Tajikistan", TM: "Turkmenistan",
};

export function countryName(iso: string): string {
  return COUNTRY_NAMES[iso.toUpperCase()] ?? iso;
}

export function countryNames(isoList: string[] | null | undefined): string[] {
  return (isoList ?? []).map(countryName);
}
