Install master to RPI5, SK 2.18.0:


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



