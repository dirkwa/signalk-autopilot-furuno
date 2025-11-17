Install master to RPI5, SK 2.18.0:


# PGN 129285 simulate pull https://github.com/SignalK/signalk-to-nmea2000/pull/121
```
cd ~
mkdir src && cd src
git clone --single-branch --branch pgn129285 https://github.com/night199uk/signalk-to-nmea2000.git
cd signalk-to-nmea2000/
npm version patch
npm pack

cd ~/.signalk
npm i ~/src/signalk-to-nmea2000/signalk-to-nmea2000-2.22.1.tgz
```

# Latest bleading edge
```
cd ~
git clone https://github.com/dirkwa/signalk-autopilot-furuno.git
cd signalk-autopilot-furuno/
npm pack

cd ~/.signalk

# modify to your pack .tgz
npm install ~/signalk-autopilot-furuno/signalk-autopilot-furuno-0.0.1.tgz


# Restart Signal K
sudo systemctl restart signalk.service  && journalctl -u signalk -f | grep -i furuno


```



