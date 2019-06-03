. ./nodeBootstrap.ps1

# Run yarn install
& ./yarn.ps1 install

# Run yarn run (pass through args to specify build tasks)
& ./yarn.ps1 run run $args
exit $LastExitCode
