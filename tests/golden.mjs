// Five golden examples with expected answers. All text is made up ("Examplia"); no real
// grid code, company or project is quoted. Every change to the extraction rules is scored
// against these with the rubric in golden.test.mjs: correct, complete, format followed.
export const GOLDEN_DOC = `GRID CODE OF EXAMPLIA

Frequency ranges

Article 12.

(1) A power park module shall remain connected to the network and operate within the frequency range of 47.5 Hz to 48.5 Hz for at least 30 minutes.

(2) Within the range 49.0 Hz – 51.0 Hz operation shall be unlimited.

Rate of change of frequency

Article 13.

A power park module must remain connected up to a rate of change of frequency of 2 Hz/s measured over 500 ms.

Reactive power capability

Article 14.

(1) At the connection point the power park module shall be capable of providing reactive power within the range Q/Pmax ≤ 0.33 as shown in Figure 4.

(2) The reactive power setpoint shall be reached within 1 minute, with a tolerance to be agreed with the transmission system operator.

Simulation models

Article 15.

The owner should provide a dynamic simulation model of the wind farm.
`;

export const GOLDEN = [
  { name: 'G1 frequency band with minimum time', clause: 'Article 12', para: '(1)', heading: 'Frequency ranges', line: 7, modality: 'mandatory', cat: 'freq_range', rel: 'ppm',
    thresholds: [{ cmp: 'range', lo: 47.5, hi: 48.5, unit: 'Hz' }, { cmp: '>=', lo: 30, unit: 'min' }], flags: [] },
  { name: 'G2 RoCoF withstand', clause: 'Article 13', para: '', heading: 'Rate of change of frequency', line: 15, modality: 'mandatory', cat: 'rocof', rel: 'ppm',
    thresholds: [{ cmp: '=', lo: 2, unit: 'Hz/s' }, { cmp: '=', lo: 500, unit: 'ms' }], flags: [] },
  { name: 'G3 reactive capability that points to a figure', clause: 'Article 14', para: '(1)', heading: 'Reactive power capability', line: 21, modality: 'mandatory', cat: 'q_cap', rel: 'ppm',
    thresholds: [{ cmp: '<=', lo: 0.33, unit: '', qty: 'Q/Pmax' }], flags: ['FIGURE'] },
  { name: 'G4 response time with an operator-defined tolerance', clause: 'Article 14', para: '(2)', heading: 'Reactive power capability', line: 23, modality: 'mandatory', cat: 'q_cap', rel: 'ppm', // inherits "power park module" from Article 14(1)
    thresholds: [{ cmp: '<=', lo: 1, unit: 'min' }], flags: ['SITE'] },
  { name: 'G5 recommendation without numbers', clause: 'Article 15', para: '', heading: 'Simulation models', line: 29, modality: 'recommended', cat: 'models', rel: 'ppm',
    thresholds: [], flags: [] },
];
