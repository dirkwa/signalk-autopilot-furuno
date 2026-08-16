# Contributing

Bug reports, feature requests and pull requests are welcome.

Run the tests before opening a PR:

```bash
npm test
```

Commits follow [Angular conventional commit](https://www.conventionalcommits.org/)
format (`fix(provider): tolerate camelCase field names`), and branch names use
hyphens rather than slashes. One logical change per PR; a version bump is its
own PR.

A note specific to this plugin: remote command of the NavPilot over NMEA 2000 is
unverified on the hardware available for testing, and the command paths are
gated behind the `experimentalCommands` setting for that reason. If you have a
NavPilot that does accept remote commands, a report either way is genuinely
useful — please say which head unit and firmware you tested against.

## Licensing of contributions

By submitting a pull request or patch, you grant Dirk Wahrheit a perpetual,
worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce,
modify, publish, sublicense and distribute your contribution, and to relicense
it under any terms, including as part of signalk-autopilot-furuno releases. You
confirm that you have the right to grant this.

This keeps future licensing decisions for the project in one pair of hands. It
does not affect what you may do with your own contribution elsewhere — you keep
your copyright in it.
