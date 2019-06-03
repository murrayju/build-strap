. ./nodeBootstrap.ps1

& $nodeExe $yarnJs --scripts-prepend-node-path=true $args
exit $LastExitCode
