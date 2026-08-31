const mexicanStateCodeMap = new Map([
  ['AG', 'AG'], ['AGU', 'AG'], ['BC', 'BC'], ['BCN', 'BC'], ['BS', 'BS'], ['BCS', 'BS'],
  ['CM', 'CM'], ['CAM', 'CM'], ['CH', 'CH'], ['CHH', 'CH'], ['CS', 'CS'], ['CHP', 'CS'],
  ['CX', 'CX'], ['CMX', 'CX'], ['CO', 'CO'], ['COA', 'CO'], ['CL', 'CL'], ['COL', 'CL'],
  ['DG', 'DG'], ['DUR', 'DG'], ['GR', 'GR'], ['GRO', 'GR'], ['GT', 'GT'], ['GUA', 'GT'],
  ['HG', 'HG'], ['HID', 'HG'], ['JA', 'JA'], ['JAL', 'JA'], ['EM', 'EM'], ['MEX', 'EM'],
  ['MI', 'MI'], ['MIC', 'MI'], ['MO', 'MO'], ['MOR', 'MO'], ['NA', 'NA'], ['NAY', 'NA'],
  ['NL', 'NL'], ['NLE', 'NL'], ['OA', 'OA'], ['OAX', 'OA'], ['PU', 'PU'], ['PUE', 'PU'],
  ['QT', 'QT'], ['QUE', 'QT'], ['QR', 'QR'], ['ROO', 'QR'], ['SI', 'SI'], ['SIN', 'SI'],
  ['SL', 'SL'], ['SLP', 'SL'], ['SO', 'SO'], ['SON', 'SO'], ['TB', 'TB'], ['TAB', 'TB'],
  ['TM', 'TM'], ['TAM', 'TM'], ['TL', 'TL'], ['TLA', 'TL'], ['VE', 'VE'], ['VER', 'VE'],
  ['YU', 'YU'], ['YUC', 'YU'], ['ZA', 'ZA'], ['ZAC', 'ZA'],
]);

export function normalizeEnviaMexicoStateCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return mexicanStateCodeMap.get(value.trim().toUpperCase()) ?? null;
}
