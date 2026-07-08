/**
 * N2KCommands - EXPERIMENTAL remote command support for the Furuno NavPilot.
 *
 * ⚠️ Remote command is UNVERIFIED on real hardware and disabled by default.
 *
 * The NavPilot uses Furuno-proprietary PGNs for control, NOT the Simrad PGN
 * 130850 an earlier version of this plugin used (which encodes empty and is
 * ignored), nor the standard PGN 126208 (which the pilot drops):
 *
 *   - Mode:   PGN 126720 (Furuno, mfr 1855) - proprietary selectors + mode value
 *   - Course: PGN 130827 (Furuno, mfr 1855) - absolute course to steer (0.0001 rad)
 *
 * "Adjust +N°" / dodge are not separate messages: send the new absolute course
 * (currentCourse ± N).
 *
 * The mode value and 126720 field packing are not fully confirmed, canboatjs has
 * no matching PGN definition yet (so these may encode empty), and the tested
 * NavPilot exposes no remote-control enable. These commands are best-effort and
 * may do nothing. Enable only for experimentation via `experimentalCommands`.
 */

// Candidate NavPilot mode values. UNVERIFIED - the wire encoding is not confirmed.
const NAVPILOT_MODE = { standby: 0, auto: 1, nav: 2 }

class N2KCommands {
  constructor(app, options = {}) {
    this.app = app
    this.enabled = options.experimentalCommands === true
    // Destination = the pilot's N2K source address if known, else broadcast.
    this.dst = options.deviceAddress != null ? options.deviceAddress : 255
  }

  initialize() {
    this.app.debug('N2K command interface initialized (experimental=' + this.enabled + ')')
  }

  get commandsEnabled() {
    return this.enabled
  }

  send(pgn, label) {
    if (!this.enabled) {
      this.app.debug('Command suppressed (experimentalCommands disabled): ' + label)
      return false
    }
    try {
      // Emit as a JSON PGN object (nmea2000JsonOut), not the string channel.
      this.app.emit('nmea2000JsonOut', pgn)
      this.app.debug('Sent experimental command [' + label + ']: ' + JSON.stringify(pgn))
      return true
    } catch (err) {
      this.app.error('Failed to send ' + label + ': ' + err.message)
      return false
    }
  }

  // Mode command - PGN 126720 (Furuno proprietary). UNVERIFIED.
  setMode(mode) {
    const modeValue = NAVPILOT_MODE[mode]
    if (modeValue === undefined) {
      this.app.debug('Unknown mode: ' + mode)
      return false
    }
    const pgn = {
      pgn: 126720,
      dst: this.dst,
      fields: {
        'Manufacturer Code': 'Furuno',
        'Industry Code': 'Marine Industry',
        // Furuno proprietary selectors (field 4 = 8, field 5 = 1) + mode (field 6).
        'Message ID': 8,
        'Command': 1,
        'Mode': modeValue
      }
    }
    return this.send(pgn, 'mode=' + mode)
  }

  // Absolute course-to-steer command - PGN 130827 (Furuno proprietary). UNVERIFIED.
  // courseRad is an absolute heading in radians.
  setCourse(courseRad) {
    const pgn = {
      pgn: 130827,
      dst: this.dst,
      fields: {
        'Manufacturer Code': 'Furuno',
        'Industry Code': 'Marine Industry',
        'Message ID': 8,
        'Commanded Course': courseRad
      }
    }
    return this.send(pgn, 'course=' + (courseRad * 180 / Math.PI).toFixed(1) + '°')
  }
}

module.exports = N2KCommands
