#!/bin/bash
# Run the archive search for every target, three at a time.
PY="${PY:-python}"
run() { for t in "$@"; do "$PY" -u find_obs.py "$t" > "obs/$t.log" 2>&1; done; }
run pluto ceres neptune makemake & run vesta uranus pallas eris & run hygiea juno haumea & wait
tail -qn 1 obs/*.log
