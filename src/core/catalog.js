// Fixed vocabularies. Order matters: charts and reports list categories in this order, and a
// category keeps its position (and so its colour) no matter how many requirements it holds.

/** Requirement categories with the phrases that vote for them. [phrase, weight]. */
export const CATEGORIES = [
  { id: 'freq_range', label: 'Frequency ranges', kw: [['frequency range', 4], ['frequency deviation', 3], ['operating period', 2], ['frequencies between', 3], ['frequency band', 3], ['underfrequency', 2], ['overfrequency', 2], ['nominal frequency', 3], ['frequency is maintained', 3]] },
  { id: 'rocof', label: 'Rate of change of frequency', kw: [['rocof', 5], ['rate of change of frequency', 5], ['frequency change rate', 5], ['hz/s', 4]] },
  { id: 'lfsm', label: 'Limited frequency sensitive mode', kw: [['lfsm', 6], ['limited frequency sensitive', 6], ['elevated frequency', 4], ['reduced frequency', 3], ['f > 50', 3], ['f < 49', 3]] },
  { id: 'fsm', label: 'Frequency control and reserves', kw: [['frequency sensitive mode', 5], ['fsm', 4], ['fcr', 4], ['frequency containment', 4], ['primary frequency', 4], ['primary regulation', 4], ['droop', 3], ['statism', 3], ['insensitivity', 3], ['dead band', 3], ['deadband', 3], ['afrr', 4], ['mfrr', 4], ['frp', 3], ['frequency response', 3], ['frequency maintenance', 3], ['power reserve', 2]] },
  { id: 'p_control', label: 'Active power control and ramp rates', kw: [['setpoint', 2], ['set-point', 2], ['set point', 2], ['active power', 2], ['ramp', 3], ['rate of change of output power', 5], ['rate of change of the power output', 5], ['technical minimum', 3], ['curtail', 3], ['one-minute average', 4], ['output power', 2], ['connection power', 1], ['high wind', 3]] },
  { id: 'v_range', label: 'Voltage ranges', kw: [['voltage range', 4], ['voltage deviation', 3], ['nominal voltage', 2], ['elevated voltage', 3], ['voltage limit', 3], ['deviation from the nominal voltage', 4], ['voltage fluctuation', 3]] },
  { id: 'q_cap', label: 'Reactive power capability', kw: [['reactive power', 3], ['q/pmax', 5], ['cos φ', 4], ['cos phi', 4], ['power factor', 4], ['capacitive', 2], ['inductive', 2]] },
  { id: 'v_control', label: 'Voltage and reactive power control', kw: [['voltage regulation', 4], ['voltage regulator', 4], ['voltage control', 4], ['reactive power control', 4], ['voltage setpoint', 3], ['regulation range', 2], ['tap-chang', 2]] },
  { id: 'frt', label: 'Fault ride-through', kw: [['fault ride', 6], ['fault-ride', 6], ['frt', 4], ['lvrt', 6], ['hvrt', 6], ['fault passage', 6], ['fault-passing', 6], ['fault state', 3], ['short circuit', 2], ['limit curve', 3], ['retained voltage', 4], ['passing through a fault', 5]] },
  { id: 'fault_current', label: 'Fault current and post-fault recovery', kw: [['fast fault current', 6], ['reactive current', 4], ['fault current', 3], ['active power recovery', 5], ['post-fault', 4], ['short-circuit current', 3]] },
  { id: 'pq', label: 'Power quality', kw: [['harmonic', 4], ['thd', 4], ['flicker', 4], ['unbalance', 3], ['asymmetry', 2], ['voltage quality', 4], ['50160', 3], ['61000', 3]] },
  { id: 'protection', label: 'Protection and disconnection', kw: [['protection', 3], ['disconnect', 2], ['relay', 3], ['reclosing', 3], ['fault clearing', 3], ['earthing', 2], ['grounding', 2], ['selectivity', 3], ['shut down', 2]] },
  { id: 'sync', label: 'Synchronisation and reconnection', kw: [['synchroniz', 4], ['synchronis', 4], ['reconnect', 4], ['re-energiz', 4], ['energization permit', 4], ['sync-check', 4], ['resynchroni', 4]] },
  { id: 'comms', label: 'Communication and data exchange', kw: [['real time', 3], ['real-time', 3], ['remote control', 4], ['scada', 5], ['information exchange', 4], ['communication', 3], ['data exchange', 4], ['measured values', 2], ['control center', 2], ['signal', 2], ['firewall', 3]] },
  { id: 'models', label: 'Simulation models and studies', kw: [['simulation model', 6], ['dynamic model', 6], ['static and dynamic model', 6], ['simulation', 3], ['dynamic analyses', 3]] },
  { id: 'testing', label: 'Compliance testing and documentation', kw: [['conformity', 4], ['compliance test', 5], ['certificate', 4], ['technical documentation', 4], ['test protocol', 4], ['trial operation', 3], ['tests', 2], ['verification', 2], ['reports on', 2]] },
  { id: 'restoration', label: 'Island operation and restoration', kw: [['island', 4], ['black start', 6], ['house load', 4], ['idle', 2], ['self-consumption', 2], ['own consumption', 2]] },
  { id: 'inertia', label: 'Synthetic inertia and grid forming', kw: [['synthetic inertia', 6], ['inertia', 3], ['grid forming', 6], ['grid-forming', 6]] },
  { id: 'stability', label: 'Stability and oscillation damping', kw: [['stability', 3], ['oscillation', 4], ['damping', 4], ['power system stabilizer', 5]] },
  { id: 'metering', label: 'Metering', kw: [['metering', 4], ['meter', 2], ['billing', 3], ['measuring equipment', 4], ['accuracy class', 4]] },
  { id: 'process', label: 'Connection process and agreements', kw: [['connection agreement', 3], ['interconnection agreement', 3], ['connection procedure', 3], ['application', 1], ['consent', 1], ['contract', 1]] },
  { id: 'general', label: 'General and definitions', kw: [] },
];
export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c, i) => [c.id, { ...c, order: i }]));

export const DOC_KINDS = [
  { id: 'tso', label: 'Transmission grid code' },
  { id: 'dso', label: 'Distribution grid code' },
  { id: 'eu', label: 'EU regulation' },
  { id: 'national', label: 'National implementation' },
  { id: 'datalist', label: 'Data and information list' },
  { id: 'standard', label: 'Technical standard' },
  { id: 'other', label: 'Other' },
];
export const DOC_KIND_BY_ID = new Map(DOC_KINDS.map((k, i) => [k.id, { ...k, order: i }]));

export const DOC_STATUS = [
  { id: 'in_force', label: 'In force' },
  { id: 'superseded', label: 'Superseded' },
  { id: 'draft', label: 'Draft' },
];

/** The four determinations. Order is fixed for charts, tables and reports. */
export const STATUSES = [
  { id: 'COMPLIANT', label: 'Compliant' },
  { id: 'PARTIAL', label: 'Partially compliant' },
  { id: 'NON_COMPLIANT', label: 'Non-compliant' },
  { id: 'INSUFFICIENT', label: 'Insufficient data' },
];
export const STATUS_BY_ID = new Map(STATUSES.map((s, i) => [s.id, { ...s, order: i }]));

/** Starter list of turbine capability parameters. The user can add any others. */
export const CAPABILITY_HINTS = [
  ['Operating time at 47.5-48.5 Hz', 'min'], ['Operating time at 48.5-49.0 Hz', 'min'], ['Operating time at 51.0-51.5 Hz', 'min'],
  ['Minimum continuous frequency', 'Hz'], ['Maximum continuous frequency', 'Hz'], ['RoCoF withstand', 'Hz/s'],
  ['LFSM-O threshold', 'Hz'], ['LFSM-O droop minimum setting', '%'], ['LFSM-O droop maximum setting', '%'], ['LFSM-O initial delay', 's'],
  ['LFSM-U threshold', 'Hz'], ['FSM droop minimum setting', '%'], ['FSM droop maximum setting', '%'],
  ['FSM frequency response insensitivity', 'mHz'], ['FSM full activation time', 's'], ['FSM initial delay', 'ms'],
  ['Active power setpoint response time', 's'], ['Active power setpoint tolerance', '%'],
  ['Reactive capability Q/Pmax (leading)', 'pu'], ['Reactive capability Q/Pmax (lagging)', 'pu'],
  ['Minimum continuous voltage', 'pu'], ['Maximum continuous voltage', 'pu'], ['Operating time at high voltage band', 'min'],
  ['FRT retained voltage', 'pu'], ['FRT duration at retained voltage', 'ms'],
  ['Voltage THD emission', '%'], ['Long-term flicker Plt', ''],
  ['Validated dynamic simulation model available', 'bool'], ['Type certificate / unit certificate available', 'bool'],
];

/**
 * Document types to look for when starting a new country. This is a checklist of kinds, not a
 * list of titles: the tool has no network access, so the actual documents must be found at the
 * operator, regulator and official-gazette sites and added by the user.
 */
export const COUNTRY_CHECKLIST = [
  { kind: 'tso', what: 'Transmission system grid code / network rules of the transmission system operator (current consolidated version and every later amendment).' },
  { kind: 'dso', what: 'Distribution system grid code, needed when the wind farm connects below transmission voltage.' },
  { kind: 'national', what: 'National parameter decisions: capacity thresholds for module types and the nationally chosen values of non-exhaustive requirements.' },
  { kind: 'eu', what: 'For EU and Energy Community members: Commission Regulation (EU) 2016/631 (requirements for generators).' },
  { kind: 'datalist', what: 'Operator lists of data, studies and documents to be submitted for wind power plants (connection application and compliance stages).' },
  { kind: 'standard', what: 'Standards the code refers to (for example power quality limits or model validation procedures).' },
  { kind: 'other', what: 'Connection procedure rules, compliance test procedures, operational notification steps and ancillary-service prequalification rules.' },
];
