// Worked example: Croatia, transmission-connected wind power plant.
//
// What this is: a condensed requirement sheet prepared from four public documents (the 2024
// Croatian transmission network rules, the national decision on RfG parameters, Regulation (EU)
// 2016/631 and the operator's wind farm signal list). Each entry restates one provision with its
// exact numbers and cites the article, paragraph or table row. The document texts themselves
// are not bundled: import your own copies to read them line by line.
//
// What it is not: the turbine capability values at the bottom are invented so that every kind
// of determination appears in the example. They describe no real turbine.
import { findThresholds, findFlags, modality } from '../core/extract.js';

const NOTE = 'Worked example. The text of this document is not bundled with the app. Add your own copy (Edit, then choose the file) to read it line by line and extract verbatim clauses.';

const DOCS = [
  { id: 'sample_doc_1', kind: 'tso', title: 'Transmission system network rules (Mrežna pravila prijenosnog sustava)', issuer: 'Croatian transmission system operator', ref: 'NN 10/2024', published: '2024-01-26', lang: 'Croatian; English working translation', version: '2024', status: 'in_force' },
  { id: 'sample_doc_2', kind: 'national', title: 'Decision on national maximum power thresholds for module types A to D and requirements of general application', issuer: 'Croatian transmission system operator', ref: 'HOPS 12/2018', published: '2018-12-03', lang: 'Croatian; English working translation', version: '2018', status: 'in_force' },
  { id: 'sample_doc_3', kind: 'eu', title: 'Commission Regulation (EU) 2016/631, network code on requirements for grid connection of generators', issuer: 'European Commission', ref: 'OJ L 112, 27.4.2016', published: '2016-04-27', lang: 'English', version: '2016', status: 'in_force' },
  { id: 'sample_doc_4', kind: 'datalist', title: 'Wind farm information list, real-time information exchange (Popis informacija VE)', issuer: 'Croatian transmission system operator', ref: 'Rev. 4', published: '2024-05-24', lang: 'Croatian; English working translation', version: 'Rev. 4', status: 'in_force' },
];

// [doc, clause, para, heading, category, applicability, text, extra finding]
const R = [
  [1, 'Article 91', '1.-2.', 'Frequency deviation', 'freq_range', 'conn', 'Nominal frequency is 50.00 Hz. In normal interconnected operation frequency is kept within 49.95 Hz to 50.05 Hz; excursions outside that band may total a maximum of 15,000 minutes per year.'],
  [1, 'Article 93', '(1)', 'Voltage quality', 'pq', 'conn', 'Planned level of total harmonic voltage distortion (THDU) at the connection point: 1.5 % at 400 kV and 220 kV, 3.0 % at 110 kV, for 95 % of 10-minute rms values over seven days. Individual emission limits are apportioned by connected power according to IEC/TR 61000-3-6.'],
  [1, 'Article 94', '(1)', 'Voltage quality', 'pq', 'conn', 'Planned level of long-term flicker is Plt = 1.0, not to be exceeded in 95 % of 120-minute intervals in any week. Individual limits are apportioned according to IEC/TR 61000-3-7.'],
  [1, 'Article 95', '(1)', 'Voltage quality', 'pq', 'conn', 'Planned level of voltage unbalance is 1.4 %, for 95 % of 10-minute averages over one week. Individual limits are determined according to IEC/TR 61000-3-13.'],
  [1, 'Article 99', '(2)', 'Protection features', 'protection', 'conn', 'Fault clearing times by first-zone protection are generally 80 ms at 400 kV, 100 ms at 220 kV and 120 ms at 110 kV; times for each connection must be agreed with the transmission system operator.'],
  [1, 'Article 100', '', 'Voltage quality monitoring device', 'pq', 'conn', 'Each connection point (billing metering point) must be equipped with a device measuring voltage quality and reactive power that can record transients caused by disturbances.'],
  [1, 'Article 101', '(2)-(3)', 'General conditions for connection', 'process', 'conn', 'Users with connection power of 10 MW or more connect to the transmission network unless both operators jointly justify a distribution connection; users with 20 MW or more connect to the transmission network.'],
  [1, 'Article 115', '', 'Adaptation to the remote control system', 'comms', 'gen', 'The producer must send to the operator control centres in real time at least: positions of switches, circuit breakers, earthing switches and tap changers; measured voltage, frequency, active and reactive power; availability for contracted services; information for supervising primary regulation.'],
  [1, 'Article 119', '', 'Delivery of active power', 'rocof', 'gen', 'Type D generation modules must remain connected up to a rate of change of frequency of 2 Hz/s within an observed period of 500 ms.'],
  [1, 'Article 120', '1.', 'Delivery of active power', 'lfsm', 'gen', 'A type D module must operate at reduced output power at elevated frequency (f > 50.20 Hz) as shown in Figure 2.'],
  [1, 'Article 120', '2.-3.', 'Delivery of active power', 'lfsm', 'gen', 'The droop (statism) setting range of type D modules must be between 2 % and 12 %; the default setting is 5 %.'],
  [1, 'Article 120', '4.', 'Delivery of active power', 'lfsm', 'gen', 'The initial delay of the frequency response of type D modules must be less than 2 s.', 'The national decision (Annex II, row 15.2.d.(iv)) allows only 500 ms for modules without inertia. Confirm which limit the operator applies to a power park module.'],
  [1, 'Article 120', '5.', 'Delivery of active power', 'lfsm', 'gen', 'Each type D module must be able to activate frequency-sensitive operation at reduced frequency (f < 49.8 Hz) with a response time of up to 2 s.'],
  [1, 'Article 121', '(1)-(2)', 'Delivery of active power', 'p_control', 'gen', 'Type D modules must receive the setpoint signal of the transmission system operator and follow the assigned active power value, with a tolerance in accordance with the transmission system operator\'s requirement.'],
  [1, 'Article 137', '(1), (3)', 'Criteria for automatic disconnection: frequency', 'freq_range', 'gen', 'At frequencies equal to or less than 47.50 Hz a generating unit may disconnect. Between 47.50 Hz and 51.50 Hz disconnection is permitted only in the manner shown in Figures 2 and 3.'],
  [1, 'Article 142', '', 'Behaviour during grid disturbances', 'frt', 'gen', 'A generation module must not disconnect as long as the voltage at the connection point is above the limit curve of Figure 6 (fault ride-through diagram for type D modules).'],
  [1, 'Article 151', '(1)', 'Special conditions for power park modules', 'rocof', 'ppm', 'The power park module must ride through a frequency change occurring at a rate of up to 2 Hz/s within an observed time frame of 500 ms.'],
  [1, 'Article 151', '(2)', 'Special conditions for power park modules', 'frt', 'ppm', 'Power park modules must satisfy the fault ride-through diagram of Figure 7 (type D power park module).'],
  [1, 'Article 152', '', 'Special conditions for power park modules', 'v_range', 'ppm', 'The power park module must remain in operation under the voltage and time conditions at the connection point shown in Figure 5.'],
  [1, 'Article 153', '(2)', 'Special conditions for power park modules', 'p_control', 'ppm', 'The control system must accept and execute, in real time and no later than 1 minute, the operator command setting the active power reference value, with a tolerance of 1 % Pn to 5 % Pn.'],
  [1, 'Article 153', '(4)', 'Special conditions for power park modules', 'q_cap', 'ppm', 'The control system must accept in real time and execute no later than one minute the operator command for the Q/Pmax reference, within the range Q/Pmax < 0.33 (inductive or capacitive), or for the voltage at the interface. Operation beyond Q/Pmax 0.33 may be separately agreed.'],
  [1, 'Article 153', '(5)-(6)', 'Special conditions for power park modules', 'q_cap', 'ppm', 'The power park module must meet the P-Q/Pmax characteristic of Figure 8 and the U-Q/Pmax characteristic of Figure 9 (type D power park modules).'],
  [1, 'Article 155', '(1)-(2)', 'Special conditions for power park modules', 'fsm', 'ppm', 'The response of the power park module, and of each of its generating units, to a change of grid frequency must follow the characteristic of Figure 10.'],
  [1, 'Article 156', '', 'Special conditions for power park modules', 'p_control', 'ppm', 'The owner must set the maximum rate of change of output power at the interface according to the specification determined by the transmission system operator.'],
  [1, 'Article 157', '', 'Special conditions for power park modules', 'freq_range', 'ppm', 'If grid frequency rises above 51.5 Hz the generating units should be shut down; they may be re-energised only with operator approval and when the frequency is ≤ 50.05 Hz.'],
  [1, 'Article 159', '(1)', 'Special conditions for power park modules', 'p_control', 'ppm', 'The change of one-minute average power between two one-minute intervals shall not exceed 10 % of the approved connection power, and the change of 15-minute average power between two 15-minute intervals shall not exceed 50 % of it.'],
  [1, 'Article 160', '', 'Special conditions for power park modules', 'p_control', 'ppm', 'During a system disturbance the operator may order a reduced rate of change of output power, which must be executed at module level within 1 minute.'],
  [1, 'Article 161', '', 'Special conditions for power park modules', 'sync', 'ppm', 'After the interface breaker has tripped, by protection or by command, an energization permit from the transmission system operator is required before it is closed again.'],
  [1, 'Article 162', '', 'Special conditions for power park modules', 'p_control', 'ppm', 'Under high wind speed the output power must be reduced gradually rather than by abruptly shutting down all generating units.'],
  [1, 'Article 163', '', 'Special conditions for power park modules', 'models', 'ppm', 'The owner must provide a detailed static and dynamic model of the generating units and of the power park module, within the time and in the format specified in the connection agreement.'],
  [1, 'Article 164', '(2)', 'Verification of compliance', 'testing', 'gen', 'The characteristics established in the connection agreement are verified by simulations and tests. The producer proposes the test programme, the transmission system operator approves it, and the producer delivers the test reports.'],
  [2, 'Annex I', '', 'National maximum power thresholds', 'process', 'gen', 'Module types: type A from 0.8 kW to below 500 kW; type B from 500 kW to below 5 MW; type C from 5 MW to below 10 MW, all below 110 kV; type D at 110 kV or above, or 10 MW and more.'],
  [2, 'Annex II', 'row 13.1.a.(i)', 'Frequency bands', 'freq_range', 'gen', 'Operating periods, types A to D: 47.5 Hz - 48.5 Hz at least 30 min; 48.5 Hz - 49.0 Hz at least 60 min; 49.0 Hz - 51.0 Hz unlimited; 51.0 Hz - 51.5 Hz 30 min.'],
  [2, 'Annex II', 'row 13.1.(b)', 'Rate of change of frequency', 'rocof', 'gen', 'Maximum rate of change of frequency at which the module stays connected: 2 Hz/s over a 500 ms measurement window.'],
  [2, 'Annex II', 'row 13.2.(a)', 'Limited frequency sensitive mode', 'lfsm', 'gen', 'LFSM-O frequency threshold 50.2 Hz; droop adjustable from 2 % to 12 %, default 5 %.'],
  [2, 'Annex II', 'row 13.4', 'Admissible active power reduction with falling frequency', 'p_control', 'ppm', 'Power park modules: no reduction of maximum output between 49 Hz and 50 Hz; below 49 Hz a reduction of 2 % of Pmax per Hz is admissible.'],
  [2, 'Annex II', 'row 13.5', 'Admissible active power reduction with falling frequency', 'p_control', 'gen', 'Ambient conditions applicable to the admissible active power reduction: not yet considered.'],
  [2, 'Annex II', 'row 15.2.c', 'LFSM-U', 'lfsm', 'gen', 'LFSM-U frequency threshold 49.8 Hz; droop adjustable between 2 % and 12 %, default 5 %. For power park modules the reference power is the available power.'],
  [2, 'Annex II', 'row 15.2.d.(i)', 'Frequency sensitive mode', 'fsm', 'gen', 'FSM parameters, types C and D: active power range at least 2 % of maximum capacity; frequency response insensitivity ≤ 10 mHz; frequency response dead band 20 - 200 mHz; droop adjustable from 2 % to 12 %.'],
  [2, 'Annex II', 'row 15.2.d.(iii)', 'Frequency sensitive mode', 'fsm', 'gen', 'Maximum admissible time for full activation of the frequency response: 30 s.'],
  [2, 'Annex II', 'row 15.2.d.(iv)', 'Frequency sensitive mode', 'fsm', 'gen', 'Maximum admissible initial delay: 2 s for modules with inertia, 500 ms for modules without inertia.'],
  [2, 'Annex II', 'row 15.2.d.(v)', 'Frequency sensitive mode', 'fsm', 'gen', 'Full activation of the frequency response must be sustained for 15 min.'],
  [2, 'Annex II', 'row 14.3.a', 'Fault ride-through capability', 'frt', 'ppm', 'Voltage-against-time profile for power park modules of types B and C: Uret 0.05, Uclear 0.15, Urec1 0.15, Urec2 0.85 (per unit); tclear 0.15 s, trec1 0.15 s, trec2 0.15 s, trec3 1.5 s. No difference between symmetrical and asymmetrical faults (row 14.3.b).'],
  [2, 'Annex II', 'row 16.3.a.(i)', 'Fault ride-through capability', 'frt', 'ppm', 'Voltage-against-time profile for type D power park modules: Uret 0, Uclear 0, Urec1 0, Urec2 0.85 (per unit); tclear 0.15 s, trec1 0.15 s, trec2 0.15 s, trec3 1.5 s. No difference between symmetrical and asymmetrical faults (row 16.3.c).'],
  [2, 'Annex II', 'row 15.3', 'Automatic disconnection due to voltage level', 'protection', 'gen', 'Automatic disconnection at the connection point for voltage below 80 % Un and above 120 % Un (types C and D).'],
  [2, 'Annex II', 'row 16.2.a', 'Voltage ranges', 'v_range', 'gen', 'Type D between 110 kV and 300 kV: operation in the range 1.118 pu to 1.15 pu for 60 minutes; shortened to 30 minutes when frequency is below 48.5 Hz or above 51 Hz.'],
  [2, 'Annex II', 'row 20.2.a', 'Reactive power capability of power park modules', 'q_cap', 'ppm', 'Reactive power capability at the connection point: Q/Pmax of 0.33 in both directions.'],
  [2, 'Annex II', 'row 20.2.b-c', 'Fast fault current injection', 'fault_current', 'ppm', 'Fast fault current injection, including asymmetrical current injection: no requirement stated.', 'No requirement is specified. Confirm with the operator that no project-specific fault current requirement will be added in the connection agreement.'],
  [2, 'Annex II', 'row 21.3.b', 'Reactive power capability at maximum capacity', 'q_cap', 'ppm', 'U-Q/Pmax profile at maximum capacity, types C and D: voltage range 0.225 pu, Q/Pmax range 0.66.'],
  [2, 'Annex II', 'row 14.4.a', 'Reconnection after disconnection', 'sync', 'gen', 'Conditions for reconnection after a network disturbance: voltage 0.9 pu ≤ U ≤ 1.1 pu; frequency 49.9 Hz ≤ f ≤ 50.1 Hz; minimum observation time 60 s; maximum gradient of power increase ≤ 20 % of Pmax per minute.', 'The source words the gradient as reactive power (jalova snaga). Article 14(4) of Regulation (EU) 2016/631 leaves the reconnection conditions to the TSO, and Article 13(7)(b) speaks of a gradient of increase in active power output. Confirm with the operator which quantity is meant.'],
  [2, 'Annex II', 'row 20.3.a', 'Post-fault power recovery of power park modules', 'fault_current', 'ppm', 'General requirement: recovery starts after 0.15 s; maximum recovery time 5 s; magnitude equal to the pre-fault value with 10 % deviation. Otherwise site specific.', 'The source words this row as reactive power recovery (jalova snaga); Article 20(3) of Regulation (EU) 2016/631 concerns post-fault active power recovery. Confirm the intended quantity with the operator.'],
  [2, 'Annex II', 'row 15.6.c.(iii)', 'Simulation models', 'models', 'ppm', 'Type D power park modules must submit the complete dynamic model to the transmission system operator; PSS/E format is preferred.'],
  [2, 'Annex II', 'row 16.4', 'Synchronisation', 'sync', 'gen', 'All connection points must have synchronisation devices with a synchro-check relay, automatic and manual. Settings: frequency difference ≤ 200 mHz, angle difference ≤ 30 degrees, voltage difference ≤ 20 kV.'],
  [2, 'Annex II', 'row 21.2', 'Synthetic inertia of power park modules', 'inertia', 'ppm', 'Operating principle and performance parameters of synthetic inertia: not yet defined, waiting for European coordination.'],
  [2, 'Annex II', 'row 15.6.b.(iv)', 'Measurement devices', 'comms', 'gen', 'Recorded fault and quality data must be stored for at least 30 days; communication protocols are defined in the connection agreement.'],
  [3, 'Article 13', '1(a)(i), Table 2', 'General requirements for type A power-generating modules', 'freq_range', 'gen', 'Continental Europe minimum operating periods: 47.5 Hz - 48.5 Hz to be specified by each TSO but not less than 30 minutes; 48.5 Hz - 49.0 Hz to be specified by each TSO but not less than the period for 47.5 Hz - 48.5 Hz; 49.0 Hz - 51.0 Hz unlimited; 51.0 Hz - 51.5 Hz 30 minutes.'],
  [3, 'Article 20', '3(a)', 'Requirements for type B power park modules', 'fault_current', 'ppm', 'The relevant TSO shall specify the post-fault active power recovery the power park module is capable of providing: when it begins (voltage criterion), the maximum allowed time, and its magnitude and accuracy.'],
  [3, 'Article 21', '2', 'Requirements for type C power park modules', 'inertia', 'ppm', 'The relevant TSO may specify that power park modules be capable of providing synthetic inertia during very fast frequency deviations, and shall then specify the operating principle and performance parameters.'],
  [4, 'Purpose and scope', '', 'Real-time information exchange', 'comms', 'ppm', 'All wind farms connected to the operator must exchange the listed real-time signals over the IEC 60870-5-104 protocol.'],
  [4, 'Signal list', 'power measurements', 'Real-time information exchange', 'comms', 'ppm', 'Active and reactive power at the interface: analogue measurements of accuracy class 0.5, sent cyclically every 4 s. Frequency measurement dead band: 10 mHz.'],
  [4, 'Signal list', 'voltage and reactive power commands', 'Voltage and reactive power regulation', 'v_control', 'ppm', 'Voltage setpoint must be settable from 0.95 pu to 1.05 pu in steps of at most 0.01 pu. Reactive power setpoint steps must not exceed 5 Mvar or 5 % of full reactive power, whichever is less. The controlled variable must be selectable between voltage, reactive power and power factor.'],
];

// Invented capability values, only to demonstrate determinations.
const DEMO = 'Demo value, invented for the worked example. Replace with your test report or certificate reference.';
const CAPS = [
  ['RoCoF withstand', 2.5, 'Hz/s'], ['Operating time at 47.5-48.5 Hz', 30, 'min'], ['Operating time at 48.5-49.0 Hz', 30, 'min'], ['Operating time at 51.0-51.5 Hz', 30, 'min'],
  ['LFSM-O droop minimum setting', 2, '%'], ['LFSM-O droop maximum setting', 10, '%'], ['FSM initial delay', 400, 'ms'], ['FSM full activation time', 35, 's'],
  ['Active power setpoint response time', 45, 's'],
];
// requirement index (1-based, order above) -> checks
const CHECKS = {
  9: [['RoCoF withstand', '>=', 2, 'Hz/s']],
  33: [['Operating time at 47.5-48.5 Hz', '>=', 30, 'min'], ['Operating time at 48.5-49.0 Hz', '>=', 60, 'min'], ['Operating time at 51.0-51.5 Hz', '>=', 30, 'min']],
  35: [['LFSM-O droop minimum setting', '<=', 2, '%'], ['LFSM-O droop maximum setting', '>=', 12, '%']],
  40: [['FSM full activation time', '<=', 30, 's']],
  41: [['FSM initial delay', '<=', 500, 'ms']],
  20: [['Active power setpoint response time', '<=', 1, 'min'], ['Active power setpoint tolerance', '<=', 5, '%']],
};

export const SAMPLE_COUNTRY = 'Croatia';
export const isSample = (r) => typeof r.id === 'string' && r.id.startsWith('sample_');

/** Records of the worked example. Ids are fixed, so loading twice changes nothing. */
export function buildSample() {
  const recs = DOCS.map((d) => ({ ...d, t: 'doc', country: SAMPLE_COUNTRY, url: '', notes: NOTE, text: '', orig: '', added: '2026-11-13' }));
  R.forEach(([doc, clause, para, heading, cat, rel, text, extra], i) => {
    const n = i + 1;
    const thresholds = findThresholds(text);
    const flags = findFlags(text, thresholds);
    if (extra) flags.unshift({ code: 'DISCREPANCY', msg: extra });
    recs.push({
      id: 'sample_req_' + String(n).padStart(2, '0'), t: 'req', code: 'CRO-' + String(n).padStart(4, '0'), docId: 'sample_doc_' + doc, country: SAMPLE_COUNTRY,
      cite: { clause, para, heading, section: '', page: null, line: 0, lineEnd: 0 }, text, ctx: '', modality: modality(text) === 'info' ? 'mandatory' : modality(text),
      cat, rel, thresholds, flags, seq: n, key: 'sample' + n,
      checks: (CHECKS[n] || []).map(([cap, cmp, value, unit]) => ({ cap, cmp, value, unit })),
    });
  });
  CAPS.forEach(([key, value, unit], i) => recs.push({ id: 'sample_cap_' + (i + 1), t: 'cap', key, value, unit, evidence: DEMO }));
  return recs;
}
export const SAMPLE_SIZE = { docs: DOCS.length, reqs: R.length, caps: CAPS.length };
