/**
 * N2KCommands - Sends NMEA2000 commands to the autopilot via Signal K
 */

const FURUNO_PGNS = {
  FURUNO_COMMAND: 130850  // Proprietary Furuno PGN
}

const FURUNO_MODES = {
  standby: 0,
  auto: 1,
  nav: 3
}

class N2KCommands {
  constructor(app) {
    this.app = app
    this.n2kCallback = null
  }

  initialize() {
    // Get the N2K output capability from Signal K
    this.n2kCallback = this.app.emit.bind(this.app, 'nmea2000out')
    this.app.debug('N2K command interface initialized')
  }

  sendPGN(pgn) {
    if (!this.n2kCallback) {
      this.app.debug('N2K callback not initialized')
      return false
    }

    try {
      this.n2kCallback(pgn)
      return true
    } catch (err) {
      this.app.error('Failed to send N2K message: ' + err.message)
      return false
    }
  }

  setMode(mode) {
    const modeValue = FURUNO_MODES[mode] || 0
    this.app.debug('Sending mode command: ' + mode + ' (value: ' + modeValue + ')')

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255, // Broadcast
      fields: {
        'Command': 'SetMode',
        'Mode': modeValue
      }
    }

    return this.sendPGN(pgn)
  }

  setHeading(heading) {
    const headingDeg = heading * 180 / Math.PI
    this.app.debug('Sending heading command: ' + headingDeg.toFixed(1) + '°')

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'SetHeading',
        'Heading': headingDeg
      }
    }

    return this.sendPGN(pgn)
  }

  dodge(adjustment) {
    const adjustmentDeg = adjustment * 180 / Math.PI
    this.app.debug('Sending dodge command: ' + adjustmentDeg.toFixed(1) + '°')

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'Dodge',
        'Adjustment': adjustmentDeg
      }
    }

    return this.sendPGN(pgn)
  }
}

module.exports = N2KCommands