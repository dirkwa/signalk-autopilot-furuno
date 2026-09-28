/**
 * NavSourceAdvertiser - makes Signal K selectable as a NavPilot NAV data source.
 *
 * The NavPilot offers a device as NAV data source (Menu > Other Menu >
 * NAV Option > Source) only if that device's PGN 126464 Transmit PGN list
 * includes the navigation PGNs. A gateway that relays Signal K's output onto
 * the bus does not list them, so the pilot ignores the 129283/129284/129285
 * Signal K sends through it ("No nav data" shortly after NAV is engaged).
 *
 * This broadcasts a Transmit PGN list on the same NMEA 2000 output that carries
 * Signal K's navigation PGNs, so it goes out from the same source address.
 * It is repeated periodically so the entry comes back after the pilot restarts
 * and re-reads the gateway's own list.
 */

// Network management PGNs plus the navigation PGNs the NavPilot needs from a
// NAV data source.
const TRANSMIT_PGNS = [
  59392, 59904, 60160, 60416, 60928, 126208, 126464, 126996, 126998,
  129283, 129284, 129285
]

const DEFAULT_INTERVAL_MS = 60 * 1000

class NavSourceAdvertiser {
  constructor(app, options = {}) {
    this.app = app
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS
    this.timer = null
    this.onOutputAvailable = () => this.advertise()
  }

  start() {
    this.stop()
    this.app.on('nmea2000OutAvailable', this.onOutputAvailable)
    this.advertise()
    this.timer = setInterval(() => this.advertise(), this.intervalMs)
  }

  stop() {
    this.app.removeListener('nmea2000OutAvailable', this.onOutputAvailable)
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  advertise() {
    try {
      this.app.emit('nmea2000JsonOut', {
        pgn: 126464,
        dst: 255,
        prio: 6,
        fields: {
          'Function Code': 'Transmit PGN list',
          list: TRANSMIT_PGNS.map((pgn) => ({ PGN: pgn }))
        }
      })
      this.app.debug('Advertised Transmit PGN list (126464) with 129283/129284/129285')
    } catch (err) {
      this.app.error('Failed to advertise Transmit PGN list: ' + err.message)
    }
  }
}

NavSourceAdvertiser.TRANSMIT_PGNS = TRANSMIT_PGNS

module.exports = NavSourceAdvertiser
