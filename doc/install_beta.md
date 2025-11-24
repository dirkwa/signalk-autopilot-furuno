Install master to RPI5, SK 2.18.0:
# Install Latest bleading edge

## Prerequirment - patched virtual analyzer to see transmitted PGNs
```
cd ~ && mkdir src && cd src
git clone https://github.com/dirkwa/visual-analyzer.git
cd visual-analyzer 
npm pack

cd ~/.signalk
npm install ~/src/visual-analyzer/visual-analyzer-1.19.2.tgz
```

## Prerequirement - patched sifnalk-to-nmea2000
```
cd ~/src
git clone https://github.com/dirkwa/signalk-to-nmea2000.git
cd signalk-to-nmea2000
npm pack

cd ~/.signalk
npm install ~/src/signalk-to-nmea2000/signalk-to-nmea2000-2.23.0.tgz
```

## signalk-autopilot-furuno
```
cd ~/src
git clone https://github.com/dirkwa/signalk-autopilot-furuno.git
cd signalk-autopilot-furuno/
npm pack

cd ~/.signalk
npm install ~/src/signalk-autopilot-furuno/signalk-autopilot-furuno-0.0.1.tgz
```

## Restart Signal K
```
sudo systemctl restart signalk.service  && journalctl -u signalk -f | grep -i furuno
```



